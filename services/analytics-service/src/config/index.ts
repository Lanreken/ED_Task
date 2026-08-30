export const analyticsServiceConfig = {
  serviceName: 'analytics-service',
  port: Number(process.env.PORT ?? 3006),
  mongoUri: process.env.MONGO_URI,
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  eventSecurity: {
    sharedSecret: process.env.EVENT_BUS_SHARED_SECRET ?? 'change-me-event-bus-secret',
    enforceSignature: process.env.EVENT_SIGNATURE_ENFORCE !== 'false',
  },
  alerting: {
    enabled: process.env.ALERTING_ENABLED !== 'false',
    pollIntervalMs: Number(process.env.ALERT_POLL_INTERVAL_MS ?? 15000),
    noEventsWindowMs: Number(process.env.ALERT_NO_EVENTS_WINDOW_MS ?? 120000),
    maxQueueWaiting: Number(process.env.ALERT_MAX_QUEUE_WAITING ?? 100),
    maxQueueFailed: Number(process.env.ALERT_MAX_QUEUE_FAILED ?? 20),
    services: {
      apiGateway: process.env.API_GATEWAY_URL ?? 'http://localhost:3000',
      taskService: process.env.TASK_SERVICE_URL ?? 'http://localhost:3002',
      reminderService: process.env.REMINDER_SERVICE_URL ?? 'http://localhost:3003',
      notificationService: process.env.NOTIFICATION_SERVICE_URL ?? 'http://localhost:3004',
      aiService: process.env.AI_SERVICE_URL ?? 'http://localhost:3005',
    },
  },
};
