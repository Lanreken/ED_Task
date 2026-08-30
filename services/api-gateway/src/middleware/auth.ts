import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { AuthContext } from '../../../../libs/common/src/index';

type AuthenticatedRequest = Request & {
  authContext?: AuthContext;
};

export function createAuthMiddleware(config: {
  enabled: boolean;
  mode: string;
  token: string;
  jwtSecret: string;
  jwtIssuer?: string;
  jwtAudience?: string;
}) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!config.enabled) {
      return next();
    }

    const header = req.header('authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Missing bearer token',
      });
    }

    const authToken = header.slice('Bearer '.length).trim();

    if (config.mode === 'jwt') {
      if (!config.jwtSecret) {
        return res.status(500).json({
          error: 'auth_not_configured',
          message: 'JWT auth is enabled but secret is missing',
        });
      }

      try {
        const payload = jwt.verify(authToken, config.jwtSecret, {
          issuer: config.jwtIssuer || undefined,
          audience: config.jwtAudience || undefined,
          algorithms: ['HS256'],
        });

        if (!payload || typeof payload !== 'object') {
          return res.status(401).json({
            error: 'unauthorized',
            message: 'Invalid JWT payload',
          });
        }

        const record = payload as Record<string, unknown>;
        const userIdValue = typeof record.userId === 'string' ? record.userId : record.sub;
        if (!userIdValue || typeof userIdValue !== 'string') {
          return res.status(401).json({
            error: 'unauthorized',
            message: 'JWT missing user identity',
          });
        }

        const roles = Array.isArray(record.roles)
          ? record.roles.filter((value): value is string => typeof value === 'string')
          : [];

        req.authContext = {
          userId: userIdValue,
          subject: typeof record.sub === 'string' ? record.sub : undefined,
          roles,
        };

        return next();
      } catch {
        return res.status(401).json({
          error: 'unauthorized',
          message: 'Invalid bearer token',
        });
      }
    }

    if (!config.token) {
      return res.status(500).json({
        error: 'auth_not_configured',
        message: 'API token auth is enabled but token is missing',
      });
    }

    if (authToken !== config.token) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid bearer token',
      });
    }

    req.authContext = undefined;
    return next();
  };
}

export function getAuthContext(req: Request) {
  return (req as AuthenticatedRequest).authContext;
}
