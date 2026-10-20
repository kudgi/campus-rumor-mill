import { config } from './config';
import { createServer } from './app';
const server = createServer();
server.listen(config.PORT, () => console.log(`Campus Rumor Mill listening on ${config.PORT}`));
