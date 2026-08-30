import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  CircuitBreaker,
  connectMongo,
  createDLQReconciliationJob,
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createRedisConnection,
  createStandardServiceMetrics,
  getEnv,
  ReconciliationManager,
} from '../../../libs/common/src/index';
import {
  attachEventSignature,
  EventTypes,
  RedisChannels,
  type EventEnvelope,
  type NotificationPayload,
} from '../../../libs/events/src/index';
import { notificationServiceConfig } from './config';
import { DeadLetterModel } from './models/DeadLetter';
import { NotificationModel } from './models/Notification';
import { createNotificationServiceRouter } from './routes';
import { startNotificationWorker } from './workers/notificationWorker';

dotenv.config();

const logger = createLogger(notificationServiceConfig.serviceName);

// Metrics
const metrics = createMetricsRegistry(notificationServiceConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);

// Circuit breaker for external notification providers
const notificationProviderCircuit = new CircuitBreaker(
  'notification-provider',
  {
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 3,
  },
  logger,
);

// Reconciliation manager
const reconciliationManager = new ReconciliationManager(logger);

/**
 * Replay DLQ items that might be retryable
 */
async function replayDLQItems() {
  const redis = createRedisConnection(
    getEnv('REDIS_URL', 'redis://localhost:6379'),
  );

  // Find DLQ items created in the last hour that might be retryable
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dlqItems = await DeadLetterModel.find({
    createdAt: { $gte: oneHourAgo },
    'error.code': { $in: [null, 'TIMEOUT', 'TEMPORARY_FAILURE', 'NETWORK_ERROR'] },
  })
    .sort({ createdAt: 1 })
    .limit(25);

  let itemsScanned = dlqItems.length;
  let itemsReplayed = 0;
  let itemsEscalated = 0;
  const errors: string[] = [];

  for (const dlqItem of dlqItems) {
    try {
      // Check if the original notification still needs to be sent
      const existingNotification = await NotificationModel.findOne({
        sourceEventId: dlqItem.originalEventId,
      });

      if (existingNotification && existingNotification.status === 'sent') {
        // Already sent, skip
        itemsEscalated++;
        continue;
      }

      // Re-queue the notification
      const payload = dlqItem.payload as {
        notification: NotificationPayload;
      };

      if (payload && payload.notification) {
        // Publish replay event
        const replayEvent: EventEnvelope = attachEventSignature({
          eventId: `dlq-replay:${dlqItem.originalEventId}:${Date.now()}`,
          type: EventTypes.NotificationSent,
          version: 1,
          source: 'notification-service',
          traceId: `dlq-replay:${Date.now()}`,
          occurredAt: new Date().toISOString(),
          payload: {
            ...payload.notification,
            notificationId: `replay-${dlqItem.originalEventId}`,
          },
        }, notificationServiceConfig.eventSecurity.sharedSecret);

        await redis.publish(
          RedisChannels.NotificationEvents,
          JSON.stringify(replayEvent),
        );

        itemsReplayed++;

        logger.info('dlq_item_replayed', {
          originalEventId: dlqItem.originalEventId,
        });
      }
    } catch (error) {
      errors.push(`DLQ ${dlqItem.originalEventId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await redis.quit();

  // Update metrics
  standardMetrics.queueJobsTotal.inc(itemsScanned);

  return { itemsScanned, itemsReplayed, itemsEscalated, errors };
}

async function bootstrap() {
  await connectMongo(notificationServiceConfig.mongoUri, notificationServiceConfig.serviceName);

  startNotificationWorker();

  // Register and start reconciliation job
  reconciliationManager.register(
    createDLQReconciliationJob(replayDLQItems, logger),
  );
  reconciliationManager.start('dlq_reconciliation');

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(createNotificationServiceRouter());
  app.use(createErrorHandler(logger));

  // Metrics endpoint
  app.get('/metrics', (_req, res) => {
    res.type('text/plain');
    res.send(metrics.toPrometheusFormat());
  });

  // Circuit breaker status endpoint
  app.get('/circuit-breaker', (_req, res) => {
    res.json(notificationProviderCircuit.getStats());
  });

  // Reconciliation status endpoint
  app.get('/reconciliation', (_req, res) => {
    res.json({
      jobs: reconciliationManager.getStatus(),
    });
  });

  app.listen(notificationServiceConfig.port, () => {
    logger.info('service_started', { port: notificationServiceConfig.port });
  });
}

// Export for testing and external use
export { metrics, notificationProviderCircuit, reconciliationManager };

bootstrap().catch((error: Error) => {
  logger.error('service_boot_failed', {
    error: error.message,
  });
  process.exit(1);
});
