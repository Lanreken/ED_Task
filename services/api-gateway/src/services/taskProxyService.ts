import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { CircuitBreaker, signServiceRequest, type Counter, type Histogram, type ServiceLogger } from '../../../../libs/common/src/index';
import { apiGatewayConfig } from '../config';
import { getAuthContext } from '../middleware/auth';

function traceIdFor(req: Request) {
  return req.header('x-trace-id') ?? randomUUID();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(status: number) {
  return status === 429 || status >= 500;
}

type TaskProxyDeps = {
  circuitBreaker: CircuitBreaker;
  logger: ServiceLogger;
  metrics: {
    requestsTotal: Counter;
    requestErrorsTotal: Counter;
    requestDuration: Histogram;
  };
};

async function forwardWithRetry(
  req: Request,
  path: string,
  traceId: string,
  maxRetries: number,
  timeoutMs: number,
) {
  const authContext = getAuthContext(req);
  const timestamp = String(Date.now());
  const idempotencyKey = req.header('idempotency-key') ?? undefined;

  const signature = signServiceRequest(apiGatewayConfig.serviceAuth.sharedSecret, {
    method: req.method,
    path,
    timestamp,
    userId: authContext?.userId,
    traceId,
    idempotencyKey,
  });

  const headers = new Headers({
    'content-type': 'application/json',
    'x-trace-id': traceId,
    [apiGatewayConfig.serviceAuth.sourceHeader]: apiGatewayConfig.serviceAuth.serviceName,
    [apiGatewayConfig.serviceAuth.timestampHeader]: timestamp,
    [apiGatewayConfig.serviceAuth.signatureHeader]: signature,
    [apiGatewayConfig.serviceAuth.forwardedPathHeader]: path,
  });

  if (idempotencyKey) {
    headers.set('idempotency-key', idempotencyKey);
  }
  if (authContext?.userId) {
    headers.set(apiGatewayConfig.serviceAuth.userHeader, authContext.userId);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${apiGatewayConfig.taskServiceUrl}${path}`, {
        method: req.method,
        headers,
        body: req.method === 'GET' ? undefined : JSON.stringify(req.body),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (attempt < maxRetries && shouldRetry(response.status)) {
        await sleep(100 * 2 ** attempt);
        continue;
      }

      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        await sleep(100 * 2 ** attempt);
        continue;
      }
    }
  }

  throw lastError ?? new Error('downstream_request_failed');
}

export function createTaskProxyService(deps: TaskProxyDeps) {
  async function forwardToTaskService(req: Request, res: Response, path: string) {
    if (!apiGatewayConfig.serviceAuth.sharedSecret) {
      return res.status(500).json({
        error: 'service_auth_not_configured',
        message: 'Internal service shared secret is missing',
      });
    }

    const traceId = traceIdFor(req);
    const start = Date.now();
    deps.metrics.requestsTotal.inc();

    try {
      const response = await deps.circuitBreaker.execute(() =>
        forwardWithRetry(
          req,
          path,
          traceId,
          apiGatewayConfig.maxRetries,
          apiGatewayConfig.requestTimeoutMs,
        ),
      );

      const body = await response.json().catch(() => ({}));
      res.status(response.status).json({
        traceId,
        ...body,
      });
    } catch (error) {
      deps.metrics.requestErrorsTotal.inc();
      const message = error instanceof Error ? error.message : String(error);

      deps.logger.error('task_proxy_failed', {
        traceId,
        path,
        method: req.method,
        error: message,
      });

      if (message.includes('Circuit breaker is OPEN')) {
        return res.status(503).json({
          traceId,
          error: 'service_unavailable',
          message: 'Task service circuit is open',
        });
      }

      return res.status(503).json({
        traceId,
        error: 'service_unavailable',
        message: 'Task service unavailable',
      });
    } finally {
      deps.metrics.requestDuration.observe((Date.now() - start) / 1000);
    }
  }

  return { forwardToTaskService };
}
