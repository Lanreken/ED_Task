import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createStandardServiceMetrics,
} from '../../../libs/common/src/index';
import { userServiceConfig } from './config';
import { createUserServiceRouter } from './routes';

dotenv.config();

const logger = createLogger(userServiceConfig.serviceName);
const metrics = createMetricsRegistry(userServiceConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
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
app.use(createUserServiceRouter());
app.get('/metrics', (_req, res) => {
  res.type('text/plain');
  res.send(metrics.toPrometheusFormat());
});
app.use(createErrorHandler(logger));

app.listen(userServiceConfig.port, () => {
  logger.info('service_started', { port: userServiceConfig.port });
});

export { metrics };
