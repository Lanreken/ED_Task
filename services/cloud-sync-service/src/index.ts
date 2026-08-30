import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import {
  createErrorHandler,
  createLogger,
  createMetricsRegistry,
  createStandardServiceMetrics,
} from '../../../libs/common/src/index';
import { cloudSyncConfig } from './config';
import { createCloudSyncRouter } from './routes';
import { CloudSnapshotService } from './services/snapshotService';

dotenv.config();

const logger = createLogger(cloudSyncConfig.serviceName);
const metrics = createMetricsRegistry(cloudSyncConfig.serviceName);
const standardMetrics = createStandardServiceMetrics(metrics);
const snapshotService = new CloudSnapshotService();
let syncInterval: NodeJS.Timeout | null = null;

async function runSync() {
  const start = Date.now();
  standardMetrics.queueJobsTotal.inc();

  try {
    const result = await snapshotService.syncNow();
    standardMetrics.queueWaitingJobs.set(0);
    logger.info('cloud_sync_completed', result);
    return result;
  } catch (error) {
    standardMetrics.queueJobsFailed.inc();
    logger.error('cloud_sync_failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    standardMetrics.requestDuration.observe((Date.now() - start) / 1000);
  }
}

async function bootstrap() {
  await snapshotService.connectAllDatabases();

  if (cloudSyncConfig.restoreOnStart) {
    await runSync();
  }

  syncInterval = setInterval(() => {
    runSync().catch((error) => {
      logger.error('cloud_sync_interval_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, cloudSyncConfig.intervalMs);
  syncInterval.unref();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(createCloudSyncRouter({ snapshotService }));

  app.get('/metrics', (_req, res) => {
    res.type('text/plain');
    res.send(metrics.toPrometheusFormat());
  });

  app.use(createErrorHandler(logger));

  app.listen(cloudSyncConfig.port, () => {
    logger.info('service_started', {
      port: cloudSyncConfig.port,
      intervalMs: cloudSyncConfig.intervalMs,
    });
  });
}

process.on('SIGINT', async () => {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  await snapshotService.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  await snapshotService.shutdown();
  process.exit(0);
});

bootstrap().catch((error) => {
  logger.error('service_boot_failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});

export { metrics };
