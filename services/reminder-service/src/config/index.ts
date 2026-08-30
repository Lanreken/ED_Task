import { getEnv } from '../../../../libs/common/src/index';

export const reminderServiceConfig = {
  serviceName: 'reminder-service',
  port: Number(process.env.PORT ?? 3003),
  mongoUri: getEnv('MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_reminder_service?authSource=admin'),
  eventSecurity: {
    sharedSecret: process.env.EVENT_BUS_SHARED_SECRET ?? 'change-me-event-bus-secret',
    enforceSignature: process.env.EVENT_SIGNATURE_ENFORCE !== 'false',
  },
  workerRateLimit: {
    taskEventsMax: Number(process.env.REMINDER_TASK_EVENTS_RATE_MAX ?? 100),
    taskEventsDurationMs: Number(process.env.REMINDER_TASK_EVENTS_RATE_DURATION_MS ?? 1000),
    reminderDueMax: Number(process.env.REMINDER_DUE_RATE_MAX ?? 50),
    reminderDueDurationMs: Number(process.env.REMINDER_DUE_RATE_DURATION_MS ?? 1000),
  },
};
