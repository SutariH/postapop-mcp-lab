import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const server = createServer();
await server.connect(new StdioServerTransport());

// stdout carries the protocol messages. Log to stderr only.
console.error('Postapop demo MCP server is running on stdio.');
