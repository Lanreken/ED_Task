import { getEnv } from '../../../../libs/common/src/index';

export const taskServiceConfig = {
  serviceName: 'task-service',
  port: Number(process.env.PORT ?? 3002),
  mongoUri: getEnv('MONGO_URI', 'mongodb://root:rootpass@localhost:27017/ed_task_service?authSource=admin'),
  serviceAuth: {
    enforce: process.env.INTERNAL_AUTH_ENFORCE !== 'false',
    trustedServiceName: process.env.INTERNAL_TRUSTED_SERVICE_NAME ?? 'api-gateway',
    sharedSecret: process.env.INTERNAL_SHARED_SECRET ?? 'change-me-internal-secret',
    signatureHeader: 'x-service-signature',
    timestampHeader: 'x-service-ts',
    sourceHeader: 'x-service-name',
    userHeader: 'x-user-id',
    forwardedPathHeader: 'x-forwarded-path',
    maxSkewMs: Number(process.env.INTERNAL_SIGNATURE_MAX_SKEW_MS ?? 60000),
  },
  serviceRateLimit: {
    createWindowMs: Number(process.env.TASK_CREATE_RATE_LIMIT_WINDOW_MS ?? 60000),
    createMaxRequests: Number(process.env.TASK_CREATE_RATE_LIMIT_MAX ?? 50),
  },
};
