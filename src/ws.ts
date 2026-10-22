import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getTrending } from './trending';
import { query } from './db/pool';
import { calculateCredibility, toPublic } from './rumors';

type Client = { socket: WebSocket; category?: string; isAlive: boolean };
const clients = new Set<Client>();
const lastCredibility = new Map<string, number>();
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
  const wss = new WebSocketServer({ server, path: '/rumors/live' });
  wss.on('connection', async (socket) => {
    const client: Client = { socket, isAlive: true };
    clients.add(client);
    socket.on('pong', () => {
      client.isAlive = true;
    });
    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (typeof message.subscribe === 'string') client.category = message.subscribe;
      } catch {
        socket.close(1003, 'Invalid message');
      }
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
  }, 30000);
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
        const credibility = calculateCredibility(rumor);
        const rounded = Math.round(credibility * 10) / 10;
        if (lastCredibility.get(rumor.id) === rounded) continue;
        lastCredibility.set(rumor.id, rounded);
        broadcast('credibility:update', { id: rumor.id, credibility: rounded }, rumor.category);
      }
      broadcast('trending:update', { items: await getTrending() });
    } catch (error) {
      console.error(error);
    }
  }, 10000);
  wss.on('close', () => {
    clearInterval(heartbeat);
    clearInterval(ticker);
  });
  return wss;
}
