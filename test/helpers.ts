import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { onTestFinished } from 'vitest';
import { createDemoApi } from '../src/demo-api.js';
import type { SchedulingApi } from '../src/scheduling-api.js';
import { createServer } from '../src/server.js';

/** A fixed clock, so the mock calendar is the same in every test run. */
export const NOW = new Date('2026-11-02T12:00:00Z');

export function createTestApi() {
  return createDemoApi({ now: () => NOW });
}

// Connects a real MCP client to the server in memory. No process, no network.
export async function connectClient(api: SchedulingApi = createTestApi()) {
  const server = createServer(api);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: 'lab-test-client', version: '1.0.0' });
  await client.connect(clientTransport);
  onTestFinished(() => client.close());

  return client;
}

/** Calls a tool and returns its text, its error flag and, when the text is JSON, the parsed data. */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content.map((part) => part.text ?? '').join('\n');

  // Tests read many result shapes. `any` keeps the assertions short.
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }

  return { isError: result.isError === true, text, json };
}
