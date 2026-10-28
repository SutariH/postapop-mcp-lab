import { createDemoApi } from './demo-api.js';
import { createRemoteServer } from './remote-server.js';

const HOST = '127.0.0.1'; // Local only. A tunnel or a reverse proxy makes it public.

// Read .env if it exists. Variables already set in the environment win.
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const port = Number(process.env.LAB_HTTP_PORT || 3333);
const issuer = (process.env.LAB_ISSUER || `http://localhost:${port}`).replace(/\/$/, '');
const allowedOrigins = (process.env.LAB_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createRemoteServer({ api: createDemoApi(), issuer, allowedOrigins });
server.listen(port, HOST, () => {
  console.error(`Postapop demo MCP server with OAuth is listening on ${issuer}/mcp`);
});
