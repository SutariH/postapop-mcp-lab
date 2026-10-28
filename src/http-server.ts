import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { SchedulingApi } from './scheduling-api.js';
import { createServer } from './server.js';

const MAX_BODY_BYTES = 1_000_000;

interface HttpServerOptions {
  api: SchedulingApi;
  /** The shared demo token. A real product needs per-user auth, such as OAuth. */
  token: string;
  /** Browser origins that may call the server. Requests without an Origin header are not from a browser page. */
  allowedOrigins?: string[];
}

/**
 * A stateless Streamable HTTP endpoint at POST /mcp.
 * Each request gets a fresh MCP server and transport. The API is shared,
 * so data (such as new drafts) lives across requests.
 */
export function createHttpServer({ api, token, allowedOrigins = [] }: HttpServerOptions) {
  return createNodeServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (error) {
      console.error('Unexpected error in an HTTP request:', error);
      if (!res.headersSent) {
        sendError(res, 500, -32603, 'Internal server error.');
      }
    }
  });

  async function handleRequest(req: IncomingMessage, res: ServerResponse) {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/mcp') {
      return sendError(res, 404, -32000, 'Not found. The MCP endpoint is POST /mcp.');
    }

    // A web page in a browser must not be able to call a local server (DNS rebinding).
    // Browsers always send Origin on such requests; command-line clients do not.
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      return sendError(res, 403, -32000, `Forbidden. The origin ${origin} is not allowed.`);
    }

    if (!hasValidToken(req.headers.authorization, token)) {
      res.setHeader('WWW-Authenticate', 'Bearer');
      return sendError(res, 401, -32001, 'Unauthorized. Send the header Authorization: Bearer <token>.');
    }

    // A stateless server has no stream to resume (GET) and no session to end (DELETE).
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendError(res, 405, -32000, 'Method not allowed. This server accepts POST only.');
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return error instanceof BodyTooLargeError
        ? sendError(res, 413, -32600, 'The request body is larger than 1 MB.')
        : sendError(res, 400, -32700, 'Parse error. The request body is not valid JSON.');
    }

    const server = createServer(api);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }
}

/** Compares in constant time, so the response time does not leak how much of the token matched. */
function hasValidToken(header: string | undefined, expected: string) {
  const match = /^Bearer (.+)$/.exec(header ?? '');
  if (!match?.[1]) {
    return false;
  }
  const given = createHash('sha256').update(match[1]).digest();
  const wanted = createHash('sha256').update(expected).digest();
  return timingSafeEqual(given, wanted);
}

export class BodyTooLargeError extends Error {}

export async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

export function sendError(res: ServerResponse, status: number, code: number, message: string) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}
