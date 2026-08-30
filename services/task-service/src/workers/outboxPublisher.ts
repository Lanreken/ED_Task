import { Queue } from 'bullmq';
import dotenv from 'dotenv';
import {
  connectMongo,
  createLogger,
  createMetricsRegistry,
  createOutboxReconciliationJob,
  createRedisConnection,
  createStandardServiceMetrics,
  getEnv,
  ReconciliationManager,
} from '../../../../libs/common/src/index';
import {
  attachEventSignature,
  EventTypes,
  QueueNames,
  RedisChannels,
  type EventEnvelope,
} from '../../../../libs/events/src/index';
import { OutboxEventModel } from '../models/OutboxEvent';

dotenv.config();

const serviceName = 'task-service-outbox-publisher';
const logger = createLogger(serviceName);
const maxAttempts = Number(process.env.OUTBOX_MAX_ATTEMPTS ?? 5);
const eventBusSharedSecret = process.env.EVENT_BUS_SHARED_SECRET ?? 'change-me-event-bus-secret';

// Metrics
const metrics = createMetricsRegistry(serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);

// Reconciliation manager
const reconciliationManager = new ReconciliationManager(logger);

function nextBackoffDate(retryCount: number) {
  const baseDelayMs = 1000 * 2 ** retryCount;
  const jitterMs = Math.floor(Math.random() * 500);
  return new Date(Date.now() + baseDelayMs + jitterMs);
}

async function publishPendingEvents() {
  const redis = createRedisConnection();
  const taskEventsQueue = new Queue(QueueNames.TaskEvents, { connection: redis });

  const events = await OutboxEventModel.find({
    status: 'pending',
    nextAttemptAt: { $lte: new Date() },
  })
    .sort({ createdAt: 1 })
    .limit(25);

  // Update gauge for pending events
  const pendingCount = await OutboxEventModel.countDocuments({ status: 'pending' });
  standardMetrics.queueWaitingJobs.set(pendingCount);

  for (const event of events) {
    standardMetrics.queueJobsTotal.inc();
    
    const envelope: EventEnvelope = {
      eventId: event.eventId,
      type: event.type,
      version: event.version,
      source: event.sourceService,
      traceId: event.traceId,
      occurredAt: event.createdAt.toISOString(),
      payload: event.payload,
    };
    const signedEnvelope = attachEventSignature(envelope, eventBusSharedSecret);

    try {
      await taskEventsQueue.add(event.type, signedEnvelope, {
        jobId: event.eventId,
        attempts: 1,
        removeOnComplete: 1000,
        removeOnFail: false,
      });

      await redis.publish(RedisChannels.TaskEvents, JSON.stringify(signedEnvelope));

      event.status = 'published';
      event.processedAt = new Date();
      event.lastError = null;
      await event.save();

      logger.info('event_published', {
        eventId: event.eventId,
        type: event.type,
      });
    } catch (error) {
      standardMetrics.queueJobsFailed.inc();
      
      event.retryCount += 1;
      event.lastError = error instanceof Error ? error.message : String(error);
      event.nextAttemptAt = nextBackoffDate(event.retryCount);

      if (event.retryCount >= maxAttempts) {
        event.status = 'failed';
      }

      await event.save();

      logger.error('event_publish_failed', {
        eventId: event.eventId,
        type: event.type,
        retryCount: event.retryCount,
        error: event.lastError,
      });
    }
  }

  await taskEventsQueue.close();
  await redis.quit();
}

/**
 * Republish stuck outbox events - used by reconciliation job
 */
async function republishStuckEvents() {
  const redis = createRedisConnection();
  const taskEventsQueue = new Queue(QueueNames.TaskEvents, { connection: redis });

  // Find events that are pending and haven't been attempted yet or are retryable
  const stuckEvents = await OutboxEventModel.find({
    status: 'pending',
    $or: [
      { retryCount: 0 },
      { nextAttemptAt: { $lte: new Date() }, retryCount: { $lt: maxAttempts } },
    ],
  })
    .sort({ createdAt: 1 })
    .limit(50);

  let republished = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const event of stuckEvents) {
    try {
      const envelope: EventEnvelope = {
        eventId: event.eventId,
        type: event.type,
        version: event.version,
        source: event.sourceService,
        traceId: event.traceId,
        occurredAt: event.createdAt.toISOString(),
        payload: event.payload,
      };
      const signedEnvelope = attachEventSignature(envelope, eventBusSharedSecret);

      await taskEventsQueue.add(event.type, signedEnvelope, {
        jobId: event.eventId,
        attempts: 1,
        removeOnComplete: 1000,
        removeOnFail: false,
      });

      await redis.publish(RedisChannels.TaskEvents, JSON.stringify(signedEnvelope));

      event.status = 'published';
      event.processedAt = new Date();
      event.lastError = null;
      await event.save();

      republished++;
    } catch (error) {
      failed++;
      errors.push(`Event ${event.eventId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await taskEventsQueue.close();
  await redis.quit();

  return { republished, failed, errors };
}

async function run() {
  await connectMongo(
    getEnv('MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_task_service?authSource=admin'),
    serviceName,
  );

  logger.info('publisher_started');

  // Register and start reconciliation job
  reconciliationManager.register(
    createOutboxReconciliationJob(republishStuckEvents, logger),
  );
  reconciliationManager.start('outbox_reconciliation');

  // Regular publishing loop
  setInterval(() => {
    publishPendingEvents().catch((error) => {
      logger.error('publisher_loop_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 2000));
}

// Export for testing and metrics endpoint
export { metrics, reconciliationManager };

run().catch((error) => {
  logger.error('publisher_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
