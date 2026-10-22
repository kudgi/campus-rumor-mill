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
import { attachWebSocket } from './ws';
import { query } from './db/pool';
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
  app.use(errorHandler);
  return app;
}
export function createServer() {
  const server = http.createServer(createApp());
  attachWebSocket(server);
  return server;
}
