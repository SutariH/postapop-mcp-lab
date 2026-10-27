import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SERVER_INFO = { name: 'postapop-demo', version: '0.1.0' };

export function createServer() {
  const server = new McpServer(SERVER_INFO);

  // Steps 2 to 4 register tools here.

  return server;
}
