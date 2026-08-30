import { Router } from 'express';
import { createHealthHandler } from '../../../../libs/common/src/index';
import { reminderServiceConfig } from '../config';

export function createReminderServiceRouter() {
  const router = Router();

  router.get('/health', createHealthHandler(reminderServiceConfig.serviceName));
  router.get('/ready', createHealthHandler(reminderServiceConfig.serviceName));

  return router;
}
