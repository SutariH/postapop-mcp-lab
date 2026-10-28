import { createServer as createNodeServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { BodyTooLargeError, readJsonBody, sendError } from './http-server.js';
import { findClient } from './oauth/clients.js';
import { consentPage, errorPage } from './oauth/consent-page.js';
import { authorizationServerMetadata, protectedResourceMetadata, wwwAuthenticate } from './oauth/metadata.js';
import { OAuthServer } from './oauth/oauth-server.js';
import type { SchedulingApi } from './scheduling-api.js';
import { createServer } from './server.js';

const MAX_FORM_BYTES = 10_000;

interface RemoteServerOptions {
  api: SchedulingApi;
  /** The public origin people and AI tools use, such as https://mcp.example.com. No trailing slash. */
  issuer: string;
  /** Browser origins that may call /mcp. Requests without an Origin header are not from a browser page. */
  allowedOrigins?: string[];
  /** For tests: a fixed clock. */
  now?: () => number;
}

/**
 * Step 7: the same MCP tools, now protected by OAuth 2.1 instead of a shared
 * token. One process plays two roles: the authorization server (discovery,
 * /authorize, the consent page, /token) and the protected resource (/mcp).
 */
export function createRemoteServer({ api, issuer, allowedOrigins = [], now }: RemoteServerOptions) {
  const oauth = new OAuthServer(issuer, now);
  const secureCookies = issuer.startsWith('https://');

  const httpServer = createNodeServer(async (req, res) => {
    try {
      await route(req, res);
    } catch (error) {
      console.error('Unexpected error in an HTTP request:', error);
      if (!res.headersSent) {
        sendError(res, 500, -32603, 'Internal server error.');
      }
    }
  });
  return Object.assign(httpServer, { oauth });

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', issuer);
    const { pathname } = url;

    if (req.method === 'GET' && (pathname === '/.well-known/oauth-protected-resource/mcp' || pathname === '/.well-known/oauth-protected-resource')) {
      return sendJson(res, 200, protectedResourceMetadata(issuer));
    }
    if (req.method === 'GET' && pathname === '/.well-known/oauth-authorization-server') {
      return sendJson(res, 200, authorizationServerMetadata(issuer));
    }
    if (req.method === 'GET' && pathname === '/authorize') {
      return authorize(req, res, url.searchParams);
    }
    const consent = /^\/consent\/([0-9a-f-]{36})$/.exec(pathname);
    if (consent?.[1] && req.method === 'GET') {
      return showConsent(req, res, consent[1]);
    }
    if (consent?.[1] && req.method === 'POST') {
      return decide(req, res, consent[1]);
    }
    if (req.method === 'POST' && pathname === '/token') {
      return token(req, res);
    }
    if (pathname === '/mcp') {
      return mcp(req, res);
    }
    return sendError(res, 404, -32000, 'Not found.');
  }

  function authorize(req: IncomingMessage, res: ServerResponse, params: URLSearchParams) {
    const result = oauth.startAuthorization(params, req.headers.referer);
    if (result.kind === 'error' && !findClient(params.get('client_id'))) {
      // Shows the id of an app that is not on the list yet, such as claude.ai (see the README).
      console.error(`Refused a sign-in from an unknown client_id: ${JSON.stringify(params.get('client_id'))}`);
    }
    if (result.kind === 'error') {
      return sendHtml(res, 400, errorPage(result.message));
    }
    if (result.kind === 'redirect') {
      return redirect(res, result.location);
    }
    // Ties the request to this browser. A consent link forwarded to someone
    // else does not work in their browser, because it has no cookie.
    res.setHeader('Set-Cookie', cookie(result.requestId, result.browserKey, 600));
    return redirect(res, `/consent/${result.requestId}`);
  }

  function showConsent(req: IncomingMessage, res: ServerResponse, requestId: string) {
    const request = oauth.pendingRequest(requestId, readCookie(req));
    if (!request) {
      return sendHtml(res, 400, errorPage('This sign-in has expired or was started in another browser. Start the connection again in your AI tool.'));
    }
    return sendHtml(res, 200, consentPage(requestId, request.client, request.redirectUri));
  }

  async function decide(req: IncomingMessage, res: ServerResponse, requestId: string) {
    // The Allow press must come from our own consent page.
    const from = req.headers.origin ?? req.headers.referer;
    if (from && originOf(from) !== new URL(issuer).origin) {
      return sendHtml(res, 403, errorPage('This answer did not come from the sign-in page.'));
    }
    let form: URLSearchParams;
    try {
      form = await readForm(req);
    } catch {
      return sendHtml(res, 400, errorPage('The form could not be read.'));
    }
    const result = oauth.decide(requestId, readCookie(req), form.get('decision') === 'allow');
    res.setHeader('Set-Cookie', cookie(requestId, '', 0));
    if (result.kind === 'error') {
      return sendHtml(res, 400, errorPage(result.message));
    }
    return redirect(res, result.location);
  }

  async function token(req: IncomingMessage, res: ServerResponse) {
    if (!(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
      return sendJson(res, 400, { error: 'invalid_request', error_description: 'Send the form as application/x-www-form-urlencoded.' });
    }
    let form: URLSearchParams;
    try {
      form = await readForm(req);
    } catch {
      return sendJson(res, 400, { error: 'invalid_request', error_description: 'The form could not be read.' });
    }
    // Behind a proxy, read the client address from the proxy's header instead.
    const result = oauth.token(form, req.socket.remoteAddress ?? 'unknown');
    if (result.status === 429) {
      res.setHeader('Retry-After', '600');
    }
    return sendJson(res, result.status, result.body);
  }

  async function mcp(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.includes(origin)) {
      return sendError(res, 403, -32000, `Forbidden. The origin ${origin} is not allowed.`);
    }

    // The key check runs BEFORE any MCP code. Only a real HTTP 401 with this
    // header makes Claude start a sign-in or refresh its key; an error inside
    // a normal MCP answer would not.
    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1];
    if (!bearer || !oauth.verifyAccessToken(bearer)) {
      res.setHeader('WWW-Authenticate', wwwAuthenticate(issuer, bearer ? 'invalid_token' : undefined));
      return sendError(res, 401, -32001, 'Unauthorized. Sign in to get an access token.');
    }

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

    // The tools call the API in this process. The access token stops here:
    // it is never passed on to another service ("token passthrough").
    const server = createServer(api);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  function cookie(requestId: string, value: string, maxAge: number) {
    return [
      `lab_consent=${value}`,
      `Path=/consent/${requestId}`,
      `Max-Age=${maxAge}`,
      'HttpOnly',
      'SameSite=Lax',
      ...(secureCookies ? ['Secure'] : []),
    ].join('; ');
  }
}

/** The cookie's Path limits it to one request's consent page, so there is only one to read. */
function readCookie(req: IncomingMessage) {
  const match = /(?:^|;\s*)lab_consent=([^;]+)/.exec(req.headers.cookie ?? '');
  return match?.[1];
}

async function readForm(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_FORM_BYTES) {
      throw new BodyTooLargeError();
    }
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

function originOf(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendHtml(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    // The consent page must not load inside another site's frame (clickjacking).
    // No form-action here: browsers apply it to the redirect after Allow too.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
  });
  res.end(html);
}

function redirect(res: ServerResponse, location: string) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}
