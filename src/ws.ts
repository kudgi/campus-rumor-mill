import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { getTrending } from './trending';
import { query } from './db/pool';
import { calculateCredibility, toPublic } from './rumors';
import { categories } from './constants';

type Client = {
  socket: WebSocket;
  category?: string;
  isAlive: boolean;
  windowStartedAt: number;
  messageCount: number;
};
const clients = new Set<Client>();
const lastCredibility = new Map<string, number>();
const subscribeSchema = z.object({
  subscribe: z.union([z.enum(['all', ...categories]), z.null()]),
});
const messageLimit = 30;
const messageWindowMs = 60_000;

export function broadcast(event: string, data: unknown, category?: string) {
  const publicData =
    typeof data === 'object' && data !== null && 'session_id' in data
      ? toPublic(data as { session_id?: string })
      : data;
  const message = JSON.stringify({ event, data: publicData });
  for (const client of clients)
    if (
      client.socket.readyState === WebSocket.OPEN &&
      (!category || !client.category || client.category === category)
    )
      client.socket.send(message);
}

export function attachWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/rumors/live', maxPayload: 4096 });
  wss.on('connection', async (socket) => {
    const client: Client = {
      socket,
      isAlive: true,
      windowStartedAt: Date.now(),
      messageCount: 0,
    };
    clients.add(client);
    socket.on('pong', () => {
      client.isAlive = true;
    });
    socket.on('error', () => {
      clients.delete(client);
    });
    socket.on('message', (raw) => {
      const now = Date.now();
      if (now - client.windowStartedAt >= messageWindowMs) {
        client.windowStartedAt = now;
        client.messageCount = 0;
      }
      client.messageCount += 1;
      if (client.messageCount > messageLimit) {
        socket.send(
          JSON.stringify({
            event: 'error',
            data: { code: 'MESSAGE_RATE_LIMITED', message: 'Too many messages' },
          }),
        );
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        socket.send(
          JSON.stringify({
            event: 'error',
            data: { code: 'INVALID_MESSAGE', message: 'Message must be valid JSON' },
          }),
        );
        return;
      }
      const result = subscribeSchema.safeParse(parsed);
      if (!result.success) {
        socket.send(
          JSON.stringify({
            event: 'error',
            data: {
              code: 'INVALID_SUBSCRIPTION',
              message: 'subscribe must be a supported category, all, or null',
            },
          }),
        );
        return;
      }
      client.category =
        result.data.subscribe && result.data.subscribe !== 'all'
          ? result.data.subscribe
          : undefined;
    });
    socket.on('close', () => clients.delete(client));
    socket.send(JSON.stringify({ event: 'trending:update', data: { items: await getTrending() } }));
  });
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      if (!client.isAlive) {
        client.socket.terminate();
        clients.delete(client);
      } else {
        client.isAlive = false;
        client.socket.ping();
      }
    }
  }, 30_000);
  const ticker = setInterval(async () => {
    try {
      const active = await query<{
        id: string;
        category: string;
        base_score: number;
        upvote_count: number;
        last_boost_at: string;
      }>('SELECT id,category,base_score,upvote_count,last_boost_at FROM rumors WHERE status=$1', [
        'active',
      ]);
      const activeIds = new Set(active.rows.map((rumor) => rumor.id));
      for (const id of lastCredibility.keys()) if (!activeIds.has(id)) lastCredibility.delete(id);
      for (const rumor of active.rows) {
        const rounded = Math.round(calculateCredibility(rumor) * 10) / 10;
        if (lastCredibility.get(rumor.id) === rounded) continue;
        lastCredibility.set(rumor.id, rounded);
        broadcast('credibility:update', { id: rumor.id, credibility: rounded }, rumor.category);
      }
      broadcast('trending:update', { items: await getTrending() });
    } catch (error) {
      console.error(error);
    }
  }, 10_000);
  return {
    wss,
    async close() {
      clearInterval(heartbeat);
      clearInterval(ticker);
      lastCredibility.clear();
      for (const client of clients) client.socket.terminate();
      clients.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
