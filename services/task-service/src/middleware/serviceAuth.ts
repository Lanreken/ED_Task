import type { NextFunction, Request, Response } from 'express';
import {
  isFreshTimestamp,
  verifyServiceRequestSignature,
} from '../../../../libs/common/src/index';
import { taskServiceConfig } from '../config';

type TrustedRequest = Request & {
  trustedUserId?: string;
};

export function createServiceAuthMiddleware() {
  return (req: TrustedRequest, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.path === '/ready' || req.path === '/metrics') {
      return next();
    }

    if (!taskServiceConfig.serviceAuth.enforce) {
      return next();
    }

    if (!taskServiceConfig.serviceAuth.sharedSecret) {
      return res.status(500).json({
        error: 'internal_auth_not_configured',
        message: 'Internal shared secret is not configured',
      });
    }

    const source = req.header(taskServiceConfig.serviceAuth.sourceHeader) ?? '';
    const signature = req.header(taskServiceConfig.serviceAuth.signatureHeader) ?? '';
    const timestamp = req.header(taskServiceConfig.serviceAuth.timestampHeader) ?? '';
    const forwardedPath = req.header(taskServiceConfig.serviceAuth.forwardedPathHeader) ?? req.originalUrl;
    const traceId = req.header('x-trace-id') ?? undefined;
    const idempotencyKey = req.header('idempotency-key') ?? undefined;
    const userId = req.header(taskServiceConfig.serviceAuth.userHeader) ?? undefined;

    if (source !== taskServiceConfig.serviceAuth.trustedServiceName) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Untrusted internal caller',
      });
    }

    if (!signature || !timestamp) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Missing internal signature headers',
      });
    }

    if (!isFreshTimestamp(timestamp, taskServiceConfig.serviceAuth.maxSkewMs)) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Stale internal request timestamp',
      });
    }

    const valid = verifyServiceRequestSignature(
      taskServiceConfig.serviceAuth.sharedSecret,
      {
        method: req.method,
        path: forwardedPath,
        timestamp,
        userId,
        traceId,
        idempotencyKey,
      },
      signature,
    );

    if (!valid) {
      return res.status(403).json({
        error: 'forbidden',
        message: 'Invalid internal request signature',
      });
    }

    req.trustedUserId = userId;
    return next();
  };
}

export function getTrustedUserId(req: Request) {
  return (req as TrustedRequest).trustedUserId;
}
