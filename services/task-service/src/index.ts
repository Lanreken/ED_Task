import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  connectMongo,
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createStandardServiceMetrics,
} from '../../../libs/common/src/index';
import { taskServiceConfig } from './config';
import { createServiceAuthMiddleware } from './middleware/serviceAuth';
import { createTaskServiceRouter } from './routes';

dotenv.config();

const logger = createLogger(taskServiceConfig.serviceName);
const metrics = createMetricsRegistry(taskServiceConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);

async function bootstrap() {
  await connectMongo(taskServiceConfig.mongoUri, taskServiceConfig.serviceName);

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(createServiceAuthMiddleware());

  app.use((req, res, next) => {
    const start = Date.now();
    standardMetrics.requestsTotal.inc();

    res.on('finish', () => {
      standardMetrics.requestDuration.observe((Date.now() - start) / 1000);
      if (res.statusCode >= 400) {
        standardMetrics.requestErrorsTotal.inc();
      }
    });

    next();
  });

  app.use(createTaskServiceRouter());
  app.get('/metrics', (_req, res) => {
    res.type('text/plain');
    res.send(metrics.toPrometheusFormat());
  });
  app.use(createErrorHandler(logger));

  app.listen(taskServiceConfig.port, () => {
    logger.info('service_started', { port: taskServiceConfig.port });
  });
}

bootstrap().catch((error) => {
  logger.error('service_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

export { metrics };
