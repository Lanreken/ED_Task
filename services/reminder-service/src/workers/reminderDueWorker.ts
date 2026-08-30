import { Queue, Worker } from 'bullmq';
import { createLogger, createRedisConnection } from '../../../../libs/common/src/index';
import {
  attachEventSignature,
  JobNames,
  QueueNames,
  RedisChannels,
  type EventEnvelope,
  type ReminderTriggeredPayload,
} from '../../../../libs/events/src/index';
import { reminderServiceConfig } from '../config';
import { JobRecordModel } from '../models/JobRecord';
import { ReminderScheduleModel } from '../models/ReminderSchedule';

const logger = createLogger('reminder-service');

export function startReminderDueWorker() {
  const connection = createRedisConnection();
  const notificationQueue = new Queue(QueueNames.NotificationSend, { connection });

  const worker = new Worker<{
    scheduleId: string;
    reminderEvent: EventEnvelope<ReminderTriggeredPayload>;
  }>(
    QueueNames.ReminderDue,
    async (job) => {
      const { scheduleId, reminderEvent } = job.data;
      const queueJobId = job.id ?? `reminder:${scheduleId}`;

      await JobRecordModel.updateOne(
        { queueJobId },
        { $set: { status: 'processing', attempts: job.attemptsMade + 1, lastError: null } },
      );

      const schedule = await ReminderScheduleModel.findById(scheduleId);
      if (!schedule || schedule.status === 'cancelled') {
        logger.warn('reminder_skipped', { scheduleId, reason: !schedule ? 'missing_schedule' : 'cancelled' });
        return;
      }

      schedule.status = 'triggered';
      await schedule.save();

      await notificationQueue.add(
        JobNames.SendNotification,
        {
          event: reminderEvent.signature
            ? reminderEvent
            : attachEventSignature(reminderEvent, reminderServiceConfig.eventSecurity.sharedSecret),
          notification: {
            taskId: reminderEvent.payload.taskId,
            userId: reminderEvent.payload.userId,
            title: reminderEvent.payload.title,
            message: `Reminder: ${reminderEvent.payload.title}`,
            channel: 'browser',
          },
        },
        {
          jobId: `notification:${reminderEvent.eventId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: 1000,
          removeOnFail: false,
        },
      );

      const reminderEventToPublish = reminderEvent.signature
        ? reminderEvent
        : attachEventSignature(reminderEvent, reminderServiceConfig.eventSecurity.sharedSecret);

      await connection.publish(RedisChannels.ReminderEvents, JSON.stringify(reminderEventToPublish));
      await JobRecordModel.updateOne({ queueJobId }, { $set: { status: 'completed' } });

      logger.info('reminder_triggered', {
        scheduleId,
        eventId: reminderEvent.eventId,
        taskId: reminderEvent.payload.taskId,
      });
    },
    {
      connection,
      limiter: {
        max: reminderServiceConfig.workerRateLimit.reminderDueMax,
        duration: reminderServiceConfig.workerRateLimit.reminderDueDurationMs,
      },
    },
  );

  worker.on('failed', async (job, error) => {
    if (job) {
      const queueJobId = job.id ?? `reminder:${job.data.scheduleId}`;
      await JobRecordModel.updateOne(
        { queueJobId },
        { $set: { status: 'failed', attempts: job.attemptsMade, lastError: error.message } },
      );
    }

    logger.error('reminder_due_job_failed', {
      jobId: job?.id,
      error: error.message,
    });
  });

  return worker;
}
