import { Router } from 'express';
import { CircuitBreaker, createHealthHandler, type Counter, type Gauge, type Histogram } from '../../../../libs/common/src/index';

type AiServiceRouterOptions = {
  circuitBreaker: CircuitBreaker;
  metrics: {
    requestsTotal: Counter;
    requestErrorsTotal: Counter;
    requestDuration: Histogram;
    queueJobsTotal: Counter;
    queueJobsFailed: Counter;
    queueActiveJobs: Gauge;
    queueWaitingJobs: Gauge;
    dbOperationsTotal: Counter;
    dbOperationErrors: Counter;
    dbOperationDuration: Histogram;
    circuitBreakerState: Gauge;
  };
};

export function createAiServiceRouter(options?: AiServiceRouterOptions) {
  const router = Router();

  router.get('/health', createHealthHandler('ai-service'));
  router.get('/ready', createHealthHandler('ai-service'));

  // AI task breakdown suggestion endpoint
  router.post('/suggest/breakdown', async (req, res) => {
    const startTime = Date.now();
    options?.metrics.requestsTotal.inc();

    try {
      const { task, userId } = req.body;

      if (!task || typeof task !== 'string') {
        options?.metrics.requestErrorsTotal.inc();
        return res.status(400).json({
          error: 'invalid_request',
          message: 'Task description is required',
        });
      }

      // Use circuit breaker for AI provider call
      const result = await options?.circuitBreaker.execute(async () => {
        // Simulate AI processing - in production, this would call OpenAI/Claude
        const breakdown = generateTaskBreakdown(task);
        return breakdown;
      });

      options?.metrics.requestDuration.observe((Date.now() - startTime) / 1000);

      res.json({
        task,
        breakdown: result,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      options?.metrics.requestErrorsTotal.inc();
      options?.metrics.requestDuration.observe((Date.now() - startTime) / 1000);

      if (error instanceof Error && error.message.includes('Circuit breaker')) {
        return res.status(503).json({
          error: 'service_unavailable',
          message: 'AI service is temporarily unavailable',
        });
      }

      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to generate suggestions',
      });
    }
  });

  // AI priority suggestion endpoint
  router.post('/suggest/priority', async (req, res) => {
    const startTime = Date.now();
    options?.metrics.requestsTotal.inc();

    try {
      const { tasks } = req.body;

      if (!Array.isArray(tasks) || tasks.length === 0) {
        options?.metrics.requestErrorsTotal.inc();
        return res.status(400).json({
          error: 'invalid_request',
          message: 'Tasks array is required',
        });
      }

      // Use circuit breaker for AI provider call
      const result = await options?.circuitBreaker.execute(async () => {
        // Simulate AI processing - in production, this would call OpenAI/Claude
        return prioritizeTasks(tasks);
      });

      options?.metrics.requestDuration.observe((Date.now() - startTime) / 1000);

      res.json({
        prioritizedTasks: result,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      options?.metrics.requestErrorsTotal.inc();
      options?.metrics.requestDuration.observe((Date.now() - startTime) / 1000);

      if (error instanceof Error && error.message.includes('Circuit breaker')) {
        return res.status(503).json({
          error: 'service_unavailable',
          message: 'AI service is temporarily unavailable',
        });
      }

      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to generate priority suggestions',
      });
    }
  });

  // Circuit breaker status
  router.get('/circuit-breaker', (_req, res) => {
    if (options?.circuitBreaker) {
      res.json(options.circuitBreaker.getStats());
    } else {
      res.json({ status: 'not_configured' });
    }
  });

  return router;
}

/**
 * Generate task breakdown - simulates AI processing
 * In production, this would call an AI provider like OpenAI or Claude
 */
function generateTaskBreakdown(task: string): string[] {
  // Simple heuristic breakdown - replace with actual AI call
  const words = task.split(' ');
  const breakdown: string[] = [];

  if (words.length > 10) {
    breakdown.push('Review and understand the full scope');
    breakdown.push('Identify key components and dependencies');
    breakdown.push('Break down into smaller subtasks');
    breakdown.push('Estimate time for each subtask');
    breakdown.push('Execute subtasks in order');
  } else {
    breakdown.push('Plan the approach');
    breakdown.push('Execute the task');
    breakdown.push('Review the results');
  }

  return breakdown;
}

/**
 * Prioritize tasks - simulates AI processing
 * In production, this would call an AI provider like OpenAI or Claude
 */
function prioritizeTasks(tasks: Array<{ id: string; title: string; dueDate?: string }>) {
  // Simple priority based on due date - replace with actual AI call
  return tasks
    .map(task => ({
      ...task,
      priority: task.dueDate ? 'high' : 'medium',
      score: task.dueDate ? new Date(task.dueDate).getTime() : Date.now(),
    }))
    .sort((a, b) => a.score - b.score)
    .map(({ priority, score, ...rest }) => ({
      ...rest,
      priority,
      suggestedOrder: true,
    }));
}