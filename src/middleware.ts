import crypto from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { AppError } from './errors';
import { query } from './db/pool';
import { z } from 'zod';

// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  namespace Express {
    interface Request {
      session?: { id: string };
      requestId?: string;
    }
  }
}
export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => handler(req, res, next).catch(next);
}
export function errorHandler(error: unknown, _req: Request, res: Response, _next: NextFunction) {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(500, 'INTERNAL_ERROR', 'Internal server error');
  if (!(error instanceof AppError)) console.error(error);
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {}),
    },
  });
}
export function requireSession(req: Request, _res: Response, next: NextFunction) {
  const header = req.get('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : req.cookies?.sessionToken;
  if (!token) return next(new AppError(401, 'AUTH_REQUIRED', 'A session token is required'));
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  query<{ id: string }>('SELECT id FROM sessions WHERE token_hash = $1', [hash])
    .then((result) => {
      if (!result.rowCount)
        return next(new AppError(401, 'INVALID_SESSION', 'Invalid session token'));
      req.session = { id: result.rows[0].id };
      next();
    })
    .catch(next);
}
export function validate<T>(
  schema: { parse: (value: unknown) => T },
  source: 'body' | 'query' | 'params' = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      req[source] = schema.parse(req[source]) as never;
      next();
    } catch (error) {
      const details =
        error instanceof z.ZodError
          ? error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
          : undefined;
      next(new AppError(400, 'VALIDATION_ERROR', 'Request validation failed', details));
    }
  };
}
