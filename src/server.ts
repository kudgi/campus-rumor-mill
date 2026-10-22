import { pool } from './db/pool';
import { config } from './config';
import { createServer } from './app';

const { server, websocket } = createServer();
let shuttingDown = false;

server.listen(config.PORT, () => console.log(`Campus Rumor Mill listening on ${config.PORT}`));

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, shutting down`);
  await websocket.close();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await pool.end();
}

process.on('SIGTERM', () =>
  shutdown('SIGTERM').catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }),
);
process.on('SIGINT', () =>
  shutdown('SIGINT').catch((error) => {
    console.error(error);
    process.exitCode = 1;
  }),
);
