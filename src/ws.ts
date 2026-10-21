import { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { getTrending } from './trending';
import { config } from './config';
import { query } from './db/pool';

type Client = { socket: WebSocket; category?: string; isAlive: boolean };
const clients = new Set<Client>();
export function broadcast(event: string, data: unknown, category?: string) {
  const message = JSON.stringify({ event, data });
  for (const client of clients)
    if (
      client.socket.readyState === WebSocket.OPEN &&
      (!category || !client.category || client.category === category)
    )
      client.socket.send(message);
}
export function attachWebSocket(server: HttpServer) {
  const wss = new WebSocketServer({ server, path: '/rumors/live' });
  wss.on('connection', (socket) => {
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
    socket.send(JSON.stringify({ event: 'trending:update', data: { items: [] } }));
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
      const active = await query<{ id: string; category: string; last_boost_at: string }>(
        'SELECT id,category,last_boost_at FROM rumors WHERE status=$1',
        ['active'],
      );
      for (const rumor of active.rows)
        broadcast(
          'credibility:update',
          {
            id: rumor.id,
            credibility: (
              await query(
                'SELECT (base_score + upvote_count * $1::numeric) * exp(-$2::numeric * EXTRACT(EPOCH FROM (now() - last_boost_at))/3600) AS credibility FROM rumors WHERE id=$3::uuid',
                [config.UPVOTE_WEIGHT, config.DECAY_LAMBDA, rumor.id],
              )
            ).rows[0].credibility,
          },
          rumor.category,
        );
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
