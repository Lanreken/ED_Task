import { getEnv } from '../../../../libs/common/src/index';

export const apiGatewayConfig = {
  serviceName: 'api-gateway',
  port: Number(process.env.PORT ?? 3000),
  taskServiceUrl: getEnv('TASK_SERVICE_URL', 'http://localhost:3002'),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 5000),
  maxRetries: Number(process.env.DOWNSTREAM_MAX_RETRIES ?? 2),
  auth: {
    enabled: process.env.API_AUTH_ENABLED === 'true',
    mode: process.env.API_AUTH_MODE ?? 'token',
    token: process.env.API_AUTH_TOKEN ?? '',
    jwtSecret: process.env.API_JWT_SECRET ?? '',
    jwtIssuer: process.env.API_JWT_ISSUER ?? '',
    jwtAudience: process.env.API_JWT_AUDIENCE ?? '',
  },
  rateLimit: {
    windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60000),
    maxRequests: Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 100),
  },
  serviceAuth: {
    serviceName: process.env.INTERNAL_CALLER_NAME ?? 'api-gateway',
    sharedSecret: process.env.INTERNAL_SHARED_SECRET ?? 'change-me-internal-secret',
    signatureHeader: 'x-service-signature',
    timestampHeader: 'x-service-ts',
    sourceHeader: 'x-service-name',
    userHeader: 'x-user-id',
    forwardedPathHeader: 'x-forwarded-path',
    maxSkewMs: Number(process.env.INTERNAL_SIGNATURE_MAX_SKEW_MS ?? 60000),
  },
};
