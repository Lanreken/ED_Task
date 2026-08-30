import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  CircuitBreaker,
  connectMongo,
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createStandardServiceMetrics,
} from '../../../libs/common/src/index';
import { aiServiceConfig } from './config';
import { createAiServiceRouter } from './routes';

dotenv.config();

const logger = createLogger(aiServiceConfig.serviceName);

// Metrics
const metrics = createMetricsRegistry(aiServiceConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);

// Circuit breaker for AI provider (e.g., OpenAI, Claude)
const aiProviderCircuit = new CircuitBreaker(
  'ai-provider',
  {
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute for AI providers
    successThreshold: 2,
  },
  logger,
);

async function bootstrap() {
  // Connect to MongoDB if URI is provided
  if (aiServiceConfig.mongoUri) {
    await connectMongo(aiServiceConfig.mongoUri, aiServiceConfig.serviceName);
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' })); // Larger limit for AI requests
  app.use(createAiServiceRouter({
    circuitBreaker: aiProviderCircuit,
    metrics: standardMetrics,
  }));
  app.use(createErrorHandler(logger));

  // Metrics endpoint
  app.get('/metrics', (_req, res) => {
    res.type('text/plain');
    res.send(metrics.toPrometheusFormat());
  });

  // Circuit breaker status endpoint
  app.get('/circuit-breaker', (_req, res) => {
    res.json(aiProviderCircuit.getStats());
  });

  app.listen(aiServiceConfig.port, () => {
    logger.info('service_started', { port: aiServiceConfig.port });
  });
}

// Export for testing and external use
export { aiProviderCircuit, metrics };

bootstrap().catch((error: Error) => {
  logger.error('service_boot_failed', {
    error: error.message,
  });
  process.exit(1);
});