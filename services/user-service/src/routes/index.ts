import { Router } from 'express';
import { createHealthHandler } from '../../../../libs/common/src/index';
import { userServiceConfig } from '../config';

export function createUserServiceRouter() {
  const router = Router();

  router.get('/health', createHealthHandler(userServiceConfig.serviceName));
  router.get('/ready', createHealthHandler(userServiceConfig.serviceName));

  return router;
}
