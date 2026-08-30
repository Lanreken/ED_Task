import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  CircuitBreaker,
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createStandardServiceMetrics,
} from '../../../libs/common/src/index';
import { apiGatewayConfig } from './config';
import { createAuthMiddleware } from './middleware/auth';
import { createRateLimitMiddleware } from './middleware/rateLimit';
import { createApiGatewayRouter } from './routes';
import { createTaskProxyService } from './services/taskProxyService';

dotenv.config();

const logger = createLogger(apiGatewayConfig.serviceName);
const metrics = createMetricsRegistry(apiGatewayConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);
const authMiddleware = createAuthMiddleware(apiGatewayConfig.auth);
const taskServiceCircuit = new CircuitBreaker(
  'task-service',
  {
    failureThreshold: 5,
    resetTimeout: 30000,
    successThreshold: 2,
  },
  logger,
);

function isPublicPath(path: string) {
  return path === '/health' || path === '/ready' || path === '/metrics' || path === '/circuit-breakers';
}

async function bootstrap() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(createRateLimitMiddleware(apiGatewayConfig.rateLimit));

  app.use((req, res, next) => {
    if (isPublicPath(req.path)) {
      return next();
    }
    return authMiddleware(req, res, next);
  });

  app.use((req, res, next) => {
    if (isPublicPath(req.path)) {
      return next();
    }

    const start = Date.now();
    standardMetrics.requestsTotal.inc();

    res.on('finish', () => {
      standardMetrics.requestDuration.observe((Date.now() - start) / 1000);
      if (res.statusCode >= 400) {
        standardMetrics.requestErrorsTotal.inc();
      }
    });

    return next();
  });

  const taskProxy = createTaskProxyService({
    circuitBreaker: taskServiceCircuit,
    logger,
    metrics: standardMetrics,
  });

  app.use(createApiGatewayRouter({ taskProxy }));

  app.get('/metrics', (_req, res) => {
    res.type('text/plain');
    res.send(metrics.toPrometheusFormat());
  });

  app.get('/circuit-breakers', (_req, res) => {
    res.json({
      taskService: taskServiceCircuit.getStats(),
    });
  });

  app.use(createErrorHandler(logger));

  app.listen(apiGatewayConfig.port, () => {
    logger.info('service_started', {
      port: apiGatewayConfig.port,
      taskServiceUrl: apiGatewayConfig.taskServiceUrl,
    });
  });
}

bootstrap().catch((error) => {
  logger.error('service_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

export { metrics, taskServiceCircuit };
