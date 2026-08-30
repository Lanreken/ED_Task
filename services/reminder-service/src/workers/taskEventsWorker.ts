import { Queue, Worker } from 'bullmq';
import { Types } from 'mongoose';
import { createLogger, createRedisConnection } from '../../../../libs/common/src/index';
import {
  attachEventSignature,
  createEventEnvelope,
  EventTypes,
  JobNames,
  QueueNames,
  type EventEnvelope,
  type ReminderTriggeredPayload,
  type TaskCompletedPayload,
  type TaskCreatedPayload,
  verifyEventEnvelopeSignature,
} from '../../../../libs/events/src/index';
import { reminderServiceConfig } from '../config';
import { JobRecordModel } from '../models/JobRecord';
import { ProcessedEventModel } from '../models/ProcessedEvent';
import { ReminderScheduleModel } from '../models/ReminderSchedule';

const logger = createLogger('reminder-service');

async function hasProcessed(eventId: string, handlerName: string) {
  return ProcessedEventModel.exists({ eventId, handlerName });
}

async function markProcessed(eventId: string, handlerName: string) {
  await ProcessedEventModel.updateOne(
    { eventId, handlerName },
    { $setOnInsert: { eventId, handlerName, processedAt: new Date() } },
    { upsert: true },
  );
}

export function startTaskEventsWorker() {
  const connection = createRedisConnection();
  const reminderDueQueue = new Queue(QueueNames.ReminderDue, { connection });

  const worker = new Worker<EventEnvelope>(
    QueueNames.TaskEvents,
    async (job) => {
      const event = job.data;
      const handlerName = `task-events:${event.type}`;

      if (
        reminderServiceConfig.eventSecurity.enforceSignature
        && !verifyEventEnvelopeSignature(event, reminderServiceConfig.eventSecurity.sharedSecret)
      ) {
        logger.warn('invalid_event_signature', {
          eventId: event.eventId,
          type: event.type,
          source: event.source,
        });
        return;
      }

      if (await hasProcessed(event.eventId, handlerName)) {
        logger.info('duplicate_event_skipped', { eventId: event.eventId, type: event.type });
        return;
      }

      if (event.type === EventTypes.TaskCreated) {
        const payload = event.payload as TaskCreatedPayload;
        const dueAt = new Date(payload.dueAt);
        const runAt = new Date(dueAt.getTime() - payload.reminderIntervalMinutes * 60 * 1000);
        const safeRunAt = runAt.getTime() > Date.now() ? runAt : new Date();
        const delay = Math.max(safeRunAt.getTime() - Date.now(), 0);

        const schedule = await ReminderScheduleModel.findOneAndUpdate(
          { sourceEventId: event.eventId },
          {
            $setOnInsert: {
              taskId: new Types.ObjectId(payload.taskId),
              userId: new Types.ObjectId(payload.userId),
              title: payload.title,
              dueAt,
              status: 'scheduled',
              runAt: safeRunAt,
              sourceEventId: event.eventId,
            },
          },
          { upsert: true, new: true },
        );

        if (!schedule) {
          throw new Error(`Failed to create reminder schedule for event ${event.eventId}`);
        }

        const reminderEvent = attachEventSignature(createEventEnvelope<ReminderTriggeredPayload>({
          type: EventTypes.ReminderTriggered,
          source: 'reminder-service',
          traceId: event.traceId,
          payload: {
            scheduleId: schedule._id.toString(),
            taskId: payload.taskId,
            userId: payload.userId,
            title: payload.title,
            dueAt: payload.dueAt,
            triggeredAt: new Date().toISOString(),
          },
        }), reminderServiceConfig.eventSecurity.sharedSecret);

        const queueJobId = `reminder:${schedule._id.toString()}`;

        await reminderDueQueue.add(
          JobNames.TriggerReminder,
          {
            scheduleId: schedule._id.toString(),
            sourceEvent: event,
            reminderEvent,
          },
          {
            jobId: queueJobId,
            delay,
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 },
            removeOnComplete: 1000,
            removeOnFail: false,
          },
        );

        await JobRecordModel.findOneAndUpdate(
          { queueJobId },
          {
            $set: {
              type: 'task_reminder',
              status: 'queued',
              payload: { eventId: event.eventId, taskId: payload.taskId, userId: payload.userId },
              attempts: 0,
              runAt: safeRunAt,
              queueJobId,
              lastError: null,
            },
          },
          { upsert: true },
        );

        await markProcessed(event.eventId, handlerName);

        logger.info('reminder_scheduled', {
          eventId: event.eventId,
          taskId: payload.taskId,
          runAt: safeRunAt.toISOString(),
          delay,
        });
      }

      if (event.type === EventTypes.TaskCompleted || event.type === EventTypes.TaskDeleted) {
        const payload = event.payload as TaskCompletedPayload;
        await ReminderScheduleModel.updateMany(
          { taskId: new Types.ObjectId(payload.taskId), status: 'scheduled' },
          { $set: { status: 'cancelled' } },
        );

        await markProcessed(event.eventId, handlerName);

        logger.info('reminders_cancelled', {
          eventId: event.eventId,
          taskId: payload.taskId,
        });
      }
    },
    {
      connection,
      limiter: {
        max: reminderServiceConfig.workerRateLimit.taskEventsMax,
        duration: reminderServiceConfig.workerRateLimit.taskEventsDurationMs,
      },
    },
  );

  worker.on('failed', (job, error) => {
    logger.error('task_event_job_failed', {
      jobId: job?.id,
      error: error.message,
    });
  });

  return worker;
}
