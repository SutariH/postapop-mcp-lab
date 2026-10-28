import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpServer } from '../src/http-server.js';
import { callTool, createTestApi } from './helpers.js';

const TOKEN = 'lab-test-token-not-a-secret';
const ALLOWED_ORIGIN = 'http://localhost:6274';

const httpServer = createHttpServer({
  api: createTestApi(),
  token: TOKEN,
  allowedOrigins: [ALLOWED_ORIGIN],
});
let endpoint: URL;

beforeAll(async () => {
  // Port 0 asks the operating system for any free port.
  await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address() as AddressInfo;
  endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
});

afterAll(async () => {
  await new Promise((resolve) => httpServer.close(resolve));
});

async function connectHttpClient() {
  const transport = new StreamableHTTPClientTransport(endpoint, {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
  });
  const client = new Client({ name: 'http-test', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

function post(headers: Record<string, string>, body = '{"jsonrpc":"2.0","id":1,"method":"tools/list"}') {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });
}

describe('Streamable HTTP transport', () => {
  it('serves the same tools as stdio to a client with the token', async () => {
    const client = await connectHttpClient();
    const { tools } = await client.listTools();
    const { isError, json } = await callTool(client, 'list_scheduled_posts');
    await client.close();

    expect(tools).toHaveLength(4);
    expect(isError).toBe(false);
    expect(json.workspace).toBe('Moss & Fern');
  });

  it('keeps data between stateless requests, because the API is shared', async () => {
    const client = await connectHttpClient();
    const draft = await callTool(client, 'create_draft_post', { text: 'Saved over HTTP.' });
    const drafts = await callTool(client, 'list_scheduled_posts', { status: 'drafts' });
    await client.close();

    expect(drafts.json.posts.map((post: { id: string }) => post.id)).toContain(draft.json.id);
  });

  it('answers 401 without a token', async () => {
    const response = await post({});

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe('Bearer');
  });

  it('answers 401 with a wrong token', async () => {
    const response = await post({ Authorization: 'Bearer wrong-token' });

    expect(response.status).toBe(401);
  });

  it('answers 403 to a browser origin that is not allowed, even with the token', async () => {
    const response = await post({ Authorization: `Bearer ${TOKEN}`, Origin: 'https://evil.example' });

    expect(response.status).toBe(403);
  });

  it('accepts an allowed origin', async () => {
    const response = await post({ Authorization: `Bearer ${TOKEN}`, Origin: ALLOWED_ORIGIN });

    expect(response.status).toBe(200);
  });

  it('answers a plain JSON-RPC call with JSON', async () => {
    const response = await post({ Authorization: `Bearer ${TOKEN}` });
    const body = (await response.json()) as { result: { tools: unknown[] } };

    expect(response.headers.get('content-type')).toContain('application/json');
    expect(body.result.tools).toHaveLength(4);
  });

  it('answers 405 to GET, because a stateless server has no stream', async () => {
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${TOKEN}` } });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
  });

  it('answers 400 to a body that is not JSON', async () => {
    const response = await post({ Authorization: `Bearer ${TOKEN}` }, 'not json');

    expect(response.status).toBe(400);
  });

  it('answers 404 outside /mcp', async () => {
    const response = await fetch(new URL('/other', endpoint), { method: 'POST' });

    expect(response.status).toBe(404);
  });
});
