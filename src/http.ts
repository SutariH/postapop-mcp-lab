import { createDemoApi } from './demo-api.js';
import { createHttpServer } from './http-server.js';

const HOST = '127.0.0.1'; // Local only. Other machines cannot connect.

// Read .env if it exists. Variables already set in the environment win.
try {
  process.loadEnvFile();
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

const token = process.env.LAB_DEMO_TOKEN ?? '';
if (token.length < 16) {
  console.error(
    'LAB_DEMO_TOKEN is missing or shorter than 16 characters. Copy .env.example to .env and set LAB_DEMO_TOKEN, for example to the output of: openssl rand -hex 32',
  );
  process.exit(1);
}

const port = Number(process.env.LAB_HTTP_PORT || 3333);
const allowedOrigins = (process.env.LAB_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const server = createHttpServer({ api: createDemoApi(), token, allowedOrigins });
server.listen(port, HOST, () => {
  console.error(`Postapop demo MCP server is listening on http://${HOST}:${port}/mcp`);
});
