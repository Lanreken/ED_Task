import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { asyncHandler, getTraceId } from '../../../../libs/common/src/index';
import { taskServiceConfig } from '../config';
import { getTrustedUserId } from '../middleware/serviceAuth';
import { TaskService } from '../services/taskService';

const router = Router();
const service = new TaskService();
const createRateRecords = new Map<string, { count: number; windowStart: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of createRateRecords.entries()) {
    if (now - value.windowStart > taskServiceConfig.serviceRateLimit.createWindowMs * 2) {
      createRateRecords.delete(key);
    }
  }
}, taskServiceConfig.serviceRateLimit.createWindowMs).unref();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const traceId = getTraceId(req);
    const trustedUserId = getTrustedUserId(req);
    const {
      userId: requestUserId,
      title,
      description,
      priority,
      dueAt,
      reminderIntervalMinutes,
      tags,
    } = req.body;
    const userId = trustedUserId ?? requestUserId;

    if (trustedUserId && requestUserId && requestUserId !== trustedUserId) {
      return res.status(403).json({ error: 'forbidden_user_mismatch' });
    }

    if (!userId || !isValidObjectId(userId)) {
      return res.status(400).json({ error: 'invalid_user_id' });
    }

    const now = Date.now();
    const current = createRateRecords.get(userId);
    if (!current || now - current.windowStart >= taskServiceConfig.serviceRateLimit.createWindowMs) {
      createRateRecords.set(userId, { count: 1, windowStart: now });
    } else {
      if (current.count >= taskServiceConfig.serviceRateLimit.createMaxRequests) {
        return res.status(429).json({ error: 'task_create_rate_limited' });
      }
      current.count += 1;
    }

    if (!title || typeof title !== 'string') {
      return res.status(400).json({ error: 'title_required' });
    }

    if (!dueAt || Number.isNaN(new Date(dueAt).getTime())) {
      return res.status(400).json({ error: 'valid_dueAt_required' });
    }

    const result = await service.createTask({
      userId,
      title,
      description,
      priority,
      dueAt,
      reminderIntervalMinutes,
      tags,
      traceId,
      idempotencyKey: req.header('idempotency-key') ?? undefined,
    });

    return res.status(result.replayed ? 200 : 201).json(result);
  }),
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const trustedUserId = getTrustedUserId(req);
    const queryUserId = req.query.userId?.toString();
    const userId = trustedUserId ?? queryUserId;

    if (trustedUserId && queryUserId && queryUserId !== trustedUserId) {
      return res.status(403).json({ error: 'forbidden_user_mismatch' });
    }

    if (!userId || !isValidObjectId(userId)) {
      return res.status(400).json({ error: 'valid_userId_query_required' });
    }

    const tasks = await service.listTasks(userId);
    return res.json({ tasks });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const trustedUserId = getTrustedUserId(req);
    const queryUserId = req.query.userId?.toString();
    const userId = trustedUserId ?? queryUserId;

    if (trustedUserId && queryUserId && queryUserId !== trustedUserId) {
      return res.status(403).json({ error: 'forbidden_user_mismatch' });
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'invalid_task_id' });
    }

    const task = await service.getTaskById(req.params.id, userId);
    if (!task) {
      return res.status(404).json({ error: 'task_not_found' });
    }

    return res.json({ task });
  }),
);

router.patch(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const trustedUserId = getTrustedUserId(req);
    const queryUserId = req.query.userId?.toString();
    const userId = trustedUserId ?? queryUserId;

    if (trustedUserId && queryUserId && queryUserId !== trustedUserId) {
      return res.status(403).json({ error: 'forbidden_user_mismatch' });
    }

    if (!isValidObjectId(req.params.id)) {
      return res.status(400).json({ error: 'invalid_task_id' });
    }

    const result = await service.completeTask(req.params.id, getTraceId(req), userId);
    if (!result) {
      return res.status(404).json({ error: 'task_not_found' });
    }

    return res.json(result);
  }),
);

export { router as taskRouter };
