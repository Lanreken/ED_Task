import { Worker } from 'bullmq';
import { Types } from 'mongoose';
import { createLogger, createRedisConnection } from '../../../../libs/common/src/index';
import {
  attachEventSignature,
  createEventEnvelope,
  EventTypes,
  QueueNames,
  RedisChannels,
  type EventEnvelope,
  type ReminderTriggeredPayload,
  verifyEventEnvelopeSignature,
} from '../../../../libs/events/src/index';
import { notificationServiceConfig } from '../config';
import { DeadLetterModel } from '../models/DeadLetter';
import { JobRecordModel } from '../models/JobRecord';
import { NotificationModel } from '../models/Notification';
import { ProcessedEventModel } from '../models/ProcessedEvent';

type NotificationJob = {
  event: EventEnvelope<ReminderTriggeredPayload>;
  notification: {
    taskId: string;
    userId: string;
    title: string;
    message: string;
    channel: 'email' | 'push' | 'sms' | 'browser';
  };
};

const logger = createLogger('notification-service');

async function simulateProviderSend(payload: NotificationJob['notification']) {
  if (process.env.FORCE_NOTIFICATION_FAILURE === 'true') {
    throw new Error('Forced notification provider failure');
  }

  return {
    provider: 'console',
    providerMessageId: `console:${payload.taskId}:${Date.now()}`,
  };
}

export function startNotificationWorker() {
  const connection = createRedisConnection();

  const worker = new Worker<NotificationJob>(
    QueueNames.NotificationSend,
    async (job) => {
      const { event, notification } = job.data;
      const handlerName = 'notification:send-reminder';
      const queueJobId = job.id ?? `notification:${event.eventId}`;

      if (
        notificationServiceConfig.eventSecurity.enforceSignature
        && !verifyEventEnvelopeSignature(event, notificationServiceConfig.eventSecurity.sharedSecret)
      ) {
        logger.warn('invalid_event_signature', {
          eventId: event.eventId,
          type: event.type,
          source: event.source,
        });
        return;
      }

      const processed = await ProcessedEventModel.exists({ eventId: event.eventId, handlerName });
      if (processed) {
        logger.info('duplicate_notification_skipped', { eventId: event.eventId });
        return;
      }

      await JobRecordModel.findOneAndUpdate(
        { queueJobId },
        {
          $set: {
            type: 'send_notification',
            status: 'processing',
            payload: job.data,
            attempts: job.attemptsMade + 1,
            runAt: new Date(),
            queueJobId,
            lastError: null,
          },
        },
        { upsert: true },
      );

      const providerResponse = await simulateProviderSend(notification);

      const record = await NotificationModel.findOneAndUpdate(
        { sourceEventId: event.eventId },
        {
          $set: {
            userId: new Types.ObjectId(notification.userId),
            taskId: new Types.ObjectId(notification.taskId),
            sourceEventId: event.eventId,
            type: notification.channel,
            message: notification.message,
            status: 'sent',
            sentAt: new Date(),
            retryCount: job.attemptsMade,
            providerResponse,
          },
        },
        { upsert: true, new: true },
      );

      if (!record) {
        throw new Error(`Failed to create notification for event ${event.eventId}`);
      }

      await ProcessedEventModel.updateOne(
        { eventId: event.eventId, handlerName },
        { $setOnInsert: { eventId: event.eventId, handlerName, processedAt: new Date() } },
        { upsert: true },
      );

      const sentEvent = attachEventSignature(createEventEnvelope({
        type: EventTypes.NotificationSent,
        source: 'notification-service',
        traceId: event.traceId,
        payload: {
          notificationId: record._id.toString(),
          taskId: notification.taskId,
          userId: notification.userId,
          channel: notification.channel,
          sentAt: new Date().toISOString(),
        },
      }), notificationServiceConfig.eventSecurity.sharedSecret);

      await connection.publish(RedisChannels.NotificationEvents, JSON.stringify(sentEvent));
      await JobRecordModel.updateOne({ queueJobId }, { $set: { status: 'completed', lastError: null } });

      logger.info('notification_sent', {
        eventId: event.eventId,
        notificationId: record._id.toString(),
      });
    },
    {
      connection,
      limiter: {
        max: notificationServiceConfig.workerRateLimit.notificationSendMax,
        duration: notificationServiceConfig.workerRateLimit.notificationSendDurationMs,
      },
    },
  );

  worker.on('failed', async (job, error) => {
    if (!job) {
      logger.error('notification_job_failed_without_job', { error: error.message });
      return;
    }

    const queueJobId = job.id ?? `notification:${job.data.event.eventId}`;

    await NotificationModel.updateOne(
      { sourceEventId: job.data.event.eventId },
      {
        $set: {
          userId: new Types.ObjectId(job.data.notification.userId),
          taskId: new Types.ObjectId(job.data.notification.taskId),
          sourceEventId: job.data.event.eventId,
          type: job.data.notification.channel,
          message: job.data.notification.message,
          status: 'failed',
          retryCount: job.attemptsMade,
        },
      },
      { upsert: true },
    );

    await JobRecordModel.findOneAndUpdate(
      { queueJobId },
      {
        $set: {
          type: 'send_notification',
          status: 'failed',
          payload: job.data,
          attempts: job.attemptsMade,
          runAt: new Date(),
          queueJobId,
          lastError: error.message,
        },
      },
      { upsert: true },
    );

    const maxAttempts = Number(job.opts.attempts ?? 1);
    if (job.attemptsMade >= maxAttempts) {
      await DeadLetterModel.create({
        originalEventId: job.data.event.eventId,
        originalType: job.data.event.type,
        payload: job.data,
        error: {
          message: error.message,
          stack: error.stack,
        },
        service: 'notification-service',
        queue: QueueNames.NotificationSend,
        retryHistory: Array.from({ length: job.attemptsMade }, (_, index) => ({
          attempt: index + 1,
          error: error.message,
          timestamp: new Date(),
        })),
      });

      const deadLetterEvent = attachEventSignature(createEventEnvelope({
        type: EventTypes.DeadLetterCreated,
        source: 'notification-service',
        traceId: job.data.event.traceId,
        payload: {
          originalEventId: job.data.event.eventId,
          originalType: job.data.event.type,
          service: 'notification-service',
          queue: QueueNames.NotificationSend,
        },
      }), notificationServiceConfig.eventSecurity.sharedSecret);

      await connection.publish(RedisChannels.SystemEvents, JSON.stringify(deadLetterEvent));
    }

    logger.error('notification_job_failed', {
      jobId: queueJobId,
      attemptsMade: job.attemptsMade,
      error: error.message,
    });
  });

  return worker;
}
