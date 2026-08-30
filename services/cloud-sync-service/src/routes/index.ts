import { Router } from 'express';
import { createHealthHandler } from '../../../../libs/common/src/index';
import { cloudSyncConfig } from '../config';
import { CloudSnapshotService } from '../services/snapshotService';

type CloudSyncRouterOptions = {
  snapshotService: CloudSnapshotService;
};

export function createCloudSyncRouter(options: CloudSyncRouterOptions) {
  const router = Router();

  router.get('/health', createHealthHandler(cloudSyncConfig.serviceName));
  router.get('/ready', createHealthHandler(cloudSyncConfig.serviceName));

  router.get('/status', (_req, res) => {
    res.json({
      service: cloudSyncConfig.serviceName,
      lastSync: options.snapshotService.getLastSync(),
    });
  });

  router.get('/snapshots', async (_req, res, next) => {
    try {
      const snapshots = await options.snapshotService.listSnapshots();
      res.json({ snapshots });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sync', async (_req, res, next) => {
    try {
      const result = await options.snapshotService.syncNow();
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  });

  router.get('/restore/latest', async (_req, res, next) => {
    try {
      const preview = await options.snapshotService.getLatestSnapshotPreview();
      if (!preview) {
        return res.status(404).json({ error: 'snapshot_not_found' });
      }

      return res.json(preview);
    } catch (error) {
      next(error);
      return undefined;
    }
  });

  return router;
}
