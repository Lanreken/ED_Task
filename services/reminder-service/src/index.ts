import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  connectMongo,
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createRedisConnection,
  createReminderReconciliationJob,
  createStandardServiceMetrics,
  getEnv,
  ReconciliationManager,
} from '../../../libs/common/src/index';
import {
  attachEventSignature,
  EventTypes,
  RedisChannels,
  type EventEnvelope,
} from '../../../libs/events/src/index';
import { reminderServiceConfig } from './config';
import { JobRecordModel } from './models/JobRecord';
import { ReminderScheduleModel } from './models/ReminderSchedule';
import { createReminderServiceRouter } from './routes';
import { startReminderDueWorker } from './workers/reminderDueWorker';
import { startTaskEventsWorker } from './workers/taskEventsWorker';

dotenv.config();

const logger = createLogger(reminderServiceConfig.serviceName);

// Metrics
export const metrics = createMetricsRegistry(reminderServiceConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);

// Reconciliation manager
const reconciliationManager = new ReconciliationManager(logger);

/**
 * Reconcile reminders - find reminders that are overdue but not triggered
 */
async function reconcileMissingReminders() {
  const redis = createRedisConnection(
    getEnv('REDIS_URL', 'redis://localhost:6379'),
  );

  let tasksScanned = 0;
  let remindersCreated = 0;
  const errors: string[] = [];

  // Check for scheduled reminders that are overdue but not triggered
  const overdueReminders = await ReminderScheduleModel.find({
    status: 'scheduled',
    runAt: { $lte: new Date() },
  }).limit(50);

  tasksScanned = overdueReminders.length;

  for (const reminder of overdueReminders) {
    try {
      // Update status to triggered and emit event
      reminder.status = 'triggered';
      await reminder.save();

      const reminderEvent: EventEnvelope = attachEventSignature({
        eventId: `reconciled:${reminder._id}:${Date.now()}`,
        type: EventTypes.ReminderTriggered,
        version: 1,
        source: 'reminder-service',
        traceId: `reconciliation:${Date.now()}`,
        occurredAt: new Date().toISOString(),
        payload: {
          scheduleId: reminder._id.toString(),
          taskId: reminder.taskId.toString(),
          userId: reminder.userId.toString(),
          title: reminder.title,
          dueAt: reminder.dueAt.toISOString(),
          triggeredAt: new Date().toISOString(),
        },
      }, reminderServiceConfig.eventSecurity.sharedSecret);

      await redis.publish(RedisChannels.ReminderEvents, JSON.stringify(reminderEvent));

      // Record the job
      await JobRecordModel.findOneAndUpdate(
        { queueJobId: `reminder:${reminder._id.toString()}` },
        {
          $set: {
            type: 'task_reminder',
            status: 'triggered',
            payload: { eventId: reminder.sourceEventId, taskId: reminder.taskId.toString() },
            attempts: 0,
            runAt: reminder.runAt,
            queueJobId: `reminder:${reminder._id.toString()}`,
            lastError: null,
          },
        },
        { upsert: true },
      );

      remindersCreated++;

      logger.info('reminder_reconciled', {
        scheduleId: reminder._id,
        taskId: reminder.taskId,
      });
    } catch (error) {
      errors.push(`Reminder ${reminder._id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  await redis.quit();

  // Update metrics
  standardMetrics.queueWaitingJobs.set(tasksScanned);

  return { tasksScanned, remindersCreated, errors };
}

async function bootstrap() {
  await connectMongo(reminderServiceConfig.mongoUri, reminderServiceConfig.serviceName);

  startTaskEventsWorker();
  startReminderDueWorker();

  // Register and start reconciliation job
  reconciliationManager.register(
    createReminderReconciliationJob(reconcileMissingReminders, logger),
  );
  reconciliationManager.start('reminder_reconciliation');

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(createReminderServiceRouter());

  app.get('/metrics', (_req, res) => {
    res.type('text/plain');
    res.send(metrics.toPrometheusFormat());
  });

  app.get('/reconciliation', (_req, res) => {
    res.json({
      jobs: reconciliationManager.getStatus(),
    });
  });

  app.use(createErrorHandler(logger));

  app.listen(reminderServiceConfig.port, () => {
    logger.info('service_started', { port: reminderServiceConfig.port });
  });
}

// Export for testing and metrics endpoint
export { reconciliationManager };

bootstrap().catch((error) => {
  logger.error('service_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
