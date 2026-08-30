import type { NextFunction, Request, Response } from 'express';

type RateLimitRecord = {
  count: number;
  windowStart: number;
};

export function createRateLimitMiddleware(config: {
  windowMs: number;
  maxRequests: number;
}) {
  const records = new Map<string, RateLimitRecord>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of records.entries()) {
      if (now - record.windowStart > config.windowMs * 2) {
        records.delete(key);
      }
    }
  }, config.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const current = records.get(key);

    if (!current || now - current.windowStart >= config.windowMs) {
      records.set(key, { count: 1, windowStart: now });
      res.setHeader('x-ratelimit-limit', String(config.maxRequests));
      res.setHeader('x-ratelimit-remaining', String(config.maxRequests - 1));
      return next();
    }

    if (current.count >= config.maxRequests) {
      const retryAfter = Math.ceil((config.windowMs - (now - current.windowStart)) / 1000);
      res.setHeader('retry-after', String(Math.max(retryAfter, 1)));
      res.setHeader('x-ratelimit-limit', String(config.maxRequests));
      res.setHeader('x-ratelimit-remaining', '0');
      return res.status(429).json({
        error: 'rate_limit_exceeded',
        message: 'Too many requests',
      });
    }

    current.count += 1;
    res.setHeader('x-ratelimit-limit', String(config.maxRequests));
    res.setHeader('x-ratelimit-remaining', String(Math.max(config.maxRequests - current.count, 0)));
    return next();
  };
}
