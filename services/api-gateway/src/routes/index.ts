import { Router } from 'express';
import { createHealthHandler } from '../../../../libs/common/src/index';
import { apiGatewayConfig } from '../config';
import { getAuthContext } from '../middleware/auth';
import { createTaskProxyService } from '../services/taskProxyService';

type ApiGatewayRouterOptions = {
  taskProxy: ReturnType<typeof createTaskProxyService>;
};

export function createApiGatewayRouter(options: ApiGatewayRouterOptions) {
  const router = Router();

  router.get('/health', createHealthHandler(apiGatewayConfig.serviceName));
  router.get('/ready', createHealthHandler(apiGatewayConfig.serviceName));

  router.post('/tasks', (req, res, next) => {
    const authContext = getAuthContext(req);
    if (authContext?.userId) {
      req.body = {
        ...req.body,
        userId: authContext.userId,
      };
    }
    options.taskProxy.forwardToTaskService(req, res, '/tasks').catch(next);
  });

  router.get('/tasks', (req, res, next) => {
    const authContext = getAuthContext(req);
    const queryRecord = { ...(req.query as Record<string, string>) };
    if (authContext?.userId) {
      queryRecord.userId = authContext.userId;
    }

    const query = new URLSearchParams(queryRecord).toString();
    options.taskProxy.forwardToTaskService(req, res, `/tasks${query ? `?${query}` : ''}`).catch(next);
  });

  router.get('/tasks/:id', (req, res, next) => {
    options.taskProxy.forwardToTaskService(req, res, `/tasks/${req.params.id}`).catch(next);
  });

  router.patch('/tasks/:id/complete', (req, res, next) => {
    options.taskProxy.forwardToTaskService(req, res, `/tasks/${req.params.id}/complete`).catch(next);
  });

  return router;
}
