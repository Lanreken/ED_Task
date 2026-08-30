import { Router } from 'express';
import { createHealthHandler } from '../../../../libs/common/src/index';
import { taskServiceConfig } from '../config';
import { taskRouter } from '../controllers/taskController';

export function createTaskServiceRouter() {
  const router = Router();

  router.get('/health', createHealthHandler(taskServiceConfig.serviceName));
  router.get('/ready', createHealthHandler(taskServiceConfig.serviceName));
  router.use('/tasks', taskRouter);

  return router;
}
