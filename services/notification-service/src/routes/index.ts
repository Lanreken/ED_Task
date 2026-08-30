import { Router } from 'express';
import { createHealthHandler } from '../../../../libs/common/src/index';
import { notificationServiceConfig } from '../config';

export function createNotificationServiceRouter() {
  const router = Router();

  router.get('/health', createHealthHandler(notificationServiceConfig.serviceName));
  router.get('/ready', createHealthHandler(notificationServiceConfig.serviceName));

  return router;
}
