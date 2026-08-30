import { getEnv } from '../../../../libs/common/src/index';

export const notificationServiceConfig = {
  serviceName: 'notification-service',
  port: Number(process.env.PORT ?? 3004),
  mongoUri: getEnv('MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_notification_service?authSource=admin'),
  eventSecurity: {
    sharedSecret: process.env.EVENT_BUS_SHARED_SECRET ?? 'change-me-event-bus-secret',
    enforceSignature: process.env.EVENT_SIGNATURE_ENFORCE !== 'false',
  },
  workerRateLimit: {
    notificationSendMax: Number(process.env.NOTIFICATION_SEND_RATE_MAX ?? 50),
    notificationSendDurationMs: Number(process.env.NOTIFICATION_SEND_RATE_DURATION_MS ?? 1000),
  },
};
