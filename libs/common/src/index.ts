import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import mongoose from 'mongoose';

export * from './circuitBreaker';
export * from './metrics';
export * from './reconciliation';
export * from './security';

export type ServiceLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

export function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function createLogger(service: string): ServiceLogger {
  function write(level: 'info' | 'warn' | 'error', message: string, meta: Record<string, unknown> = {}) {
    const line = {
      level,
      service,
      message,
      timestamp: new Date().toISOString(),
      ...meta,
    };

    const output = JSON.stringify(line);
    if (level === 'error') {
      console.error(output);
      return;
    }

    if (level === 'warn') {
      console.warn(output);
      return;
    }

    console.log(output);
  }

  return {
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

export async function connectMongo(uri: string, serviceName: string): Promise<void> {
  await mongoose.connect(uri);
  createLogger(serviceName).info('mongodb_connected', {
    database: mongoose.connection.name,
  });
}

export function createRedisConnection(redisUrl = getEnv('REDIS_URL', 'redis://localhost:6379')) {
  return new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
  });
}

export function asyncHandler<TRequest extends Request = Request>(
  handler: (req: TRequest, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: TRequest, res: Response, next: NextFunction) => {
    handler(req, res, next).catch(next);
  };
}

export function getTraceId(req: Request): string {
  const header = req.header('x-trace-id');
  return header && header.trim().length > 0 ? header : randomUUID();
}

export function createHealthHandler(service: string) {
  return (_req: Request, res: Response) => {
    res.json({
      service,
      status: 'ok',
      timestamp: new Date().toISOString(),
    });
  };
}

export function createErrorHandler(logger: ServiceLogger) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('request_failed', {
      error: err.message,
      stack: err.stack,
    });

    res.status(500).json({
      error: 'internal_error',
      message: 'Unexpected service error',
    });
  };
}
