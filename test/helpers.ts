import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { onTestFinished } from 'vitest';
import { createServer } from '../src/server.js';

// Connects a real MCP client to the server in memory. No process, no network.
export async function connectClient() {
  const server = createServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'lab-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  onTestFinished(() => client.close());

  return client;
}
