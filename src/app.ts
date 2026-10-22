import http from 'node:http';
import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { config } from './config';
import { errorHandler } from './middleware';
import sessionRouter from './session';
import rumorRouter from './rumors';
import trendingRouter from './trending';
import { attachWebSocket, broadcast } from './ws';
import { query } from './db/pool';
import { AppError } from './errors';
import path from 'node:path';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'upgrade-insecure-requests': null,
        },
      },
    }),
  );
  app.use(cors({ origin: config.CORS_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());
  app.use(pinoHttp());
  app.use(express.static(path.join(process.cwd(), 'client')));
  app.get('/health', async (_req, res, next) => {
    try {
      await query('SELECT 1');
      res.json({ status: 'ok' });
    } catch (error) {
      next(error);
    }
  });
  app.use('/session', sessionRouter);
  app.use('/rumor', rumorRouter);
  app.use('/rumors', rumorRouter);
  app.use('/trending', trendingRouter);
  app.patch('/rumor/:id/debunk', async (req, res, next) => {
    try {
      if (req.get('x-admin-api-key') !== config.ADMIN_API_KEY)
        throw new AppError(401, 'UNAUTHORIZED', 'Invalid admin API key');
      const result = await query('UPDATE rumors SET status=$1 WHERE id=$2 RETURNING id,category', [
        'debunked',
        req.params.id,
      ]);
      if (!result.rowCount) throw new AppError(404, 'NOT_FOUND', 'Rumor not found');
      broadcast('rumor:debunked', result.rows[0], result.rows[0].category);
      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  });
  app.use(errorHandler);
  return app;
}
export function createServer() {
  const server = http.createServer(createApp());
  attachWebSocket(server);
  return server;
}
