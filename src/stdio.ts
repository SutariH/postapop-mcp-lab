import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDemoApi } from './demo-api.js';
import { createServer } from './server.js';

const server = createServer(createDemoApi());
await server.connect(new StdioServerTransport());

// stdout carries the protocol messages. Log to stderr only.
console.error('Postapop demo MCP server is running on stdio.');
