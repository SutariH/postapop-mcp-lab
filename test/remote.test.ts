import { createHash } from 'node:crypto';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { UnauthorizedError, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientInformationMixed, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRemoteServer } from '../src/remote-server.js';
import { createTestApi } from './helpers.js';

const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';

/** Port 0 asks the operating system for a free port. The issuer must be known before the server starts. */
async function freePort() {
  const probe = createNetServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

let issuer: string;
let server: ReturnType<typeof createRemoteServer>;

beforeAll(async () => {
  const port = await freePort();
  issuer = `http://127.0.0.1:${port}`;
  server = createRemoteServer({ api: createTestApi(), issuer });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** Plays Claude Code's part: the SDK calls these methods during the sign-in. */
class TestProvider implements OAuthClientProvider {
  readonly clientMetadataUrl = CLAUDE_CODE;
  authorizationUrl: URL | undefined;
  private saved: OAuthTokens | undefined;
  private verifier = '';
  private info: OAuthClientInformationMixed | undefined;

  get redirectUrl() {
    return 'http://127.0.0.1:53682/callback';
  }
  get clientMetadata() {
    return { client_name: 'Lab test', redirect_uris: [this.redirectUrl], token_endpoint_auth_method: 'none' };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

/** Plays the person's browser: open the sign-in link, then press Allow on the consent page. */
async function pressAllow(authorizationUrl: URL) {
  const start = await fetch(authorizationUrl, { redirect: 'manual' });
  expect(start.status).toBe(303);
  const consentUrl = new URL(start.headers.get('location') ?? '', issuer);
  const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

  const page = await fetch(consentUrl, { headers: { cookie } });
  expect(await page.text()).toContain('Connect Claude Code to Moss &amp; Fern?');

  const allow = await fetch(consentUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, origin: issuer, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'decision=allow',
  });
  expect(allow.status).toBe(303);
  return { location: new URL(allow.headers.get('location') ?? ''), consentUrl, cookie };
}

describe('remote MCP with OAuth', () => {
  it('answers /mcp without a key with a 401 that tells the client where to sign in', async () => {
    const response = await fetch(`${issuer}/mcp`, { method: 'POST', body: '{}' });

    expect(response.status).toBe(401);
    expect(response.headers.get('www-authenticate')).toBe(
      `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp", scope="posts"`,
    );
  });

  it('serves both discovery documents', async () => {
    const resource = await (await fetch(`${issuer}/.well-known/oauth-protected-resource/mcp`)).json();
    const authServer = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();

    expect(resource).toMatchObject({ resource: `${issuer}/mcp`, authorization_servers: [issuer] });
    expect(authServer).toMatchObject({ issuer, token_endpoint: `${issuer}/token` });
  });

  it('lets the MCP SDK client sign in end to end and call a tool', async () => {
    const provider = new TestProvider();
    const firstTry = new StreamableHTTPClientTransport(new URL(`${issuer}/mcp`), { authProvider: provider });
    await expect(new Client({ name: 'lab-test', version: '1.0.0' }).connect(firstTry)).rejects.toBeInstanceOf(UnauthorizedError);

    expect(provider.authorizationUrl?.searchParams.get('client_id')).toBe(CLAUDE_CODE);
    expect(provider.authorizationUrl?.searchParams.get('code_challenge_method')).toBe('S256');
    const { location } = await pressAllow(provider.authorizationUrl!);
    await firstTry.finishAuth(location.searchParams.get('code') ?? '');

    const client = new Client({ name: 'lab-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${issuer}/mcp`), { authProvider: provider }));
    const { tools } = await client.listTools();
    await client.close();

    expect(tools.map((tool) => tool.name).sort()).toEqual(['add_design_to_post', 'create_draft_post', 'get_post_results', 'list_scheduled_posts']);
  });

  it('refuses a consent link forwarded to another browser', async () => {
    const provider = new TestProvider();
    const transport = new StreamableHTTPClientTransport(new URL(`${issuer}/mcp`), { authProvider: provider });
    await new Client({ name: 'lab-test', version: '1.0.0' }).connect(transport).catch(() => undefined);
    const start = await fetch(provider.authorizationUrl!, { redirect: 'manual' });
    const consentUrl = new URL(start.headers.get('location') ?? '', issuer);

    const forwarded = await fetch(consentUrl); // no cookie: someone else's browser
    expect(forwarded.status).toBe(400);
    expect(await forwarded.text()).toContain('started in another browser');
  });

  it('refuses an Allow press that comes from another website', async () => {
    const provider = new TestProvider();
    const transport = new StreamableHTTPClientTransport(new URL(`${issuer}/mcp`), { authProvider: provider });
    await new Client({ name: 'lab-test', version: '1.0.0' }).connect(transport).catch(() => undefined);
    const start = await fetch(provider.authorizationUrl!, { redirect: 'manual' });
    const consentUrl = new URL(start.headers.get('location') ?? '', issuer);
    const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';

    const response = await fetch(consentUrl, {
      method: 'POST',
      redirect: 'manual',
      headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
      body: 'decision=allow',
    });
    expect(response.status).toBe(403);
  });

  it('keeps the consent page out of other sites\' frames', async () => {
    const provider = new TestProvider();
    const transport = new StreamableHTTPClientTransport(new URL(`${issuer}/mcp`), { authProvider: provider });
    await new Client({ name: 'lab-test', version: '1.0.0' }).connect(transport).catch(() => undefined);
    const start = await fetch(provider.authorizationUrl!, { redirect: 'manual' });
    const cookie = (start.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const page = await fetch(new URL(start.headers.get('location') ?? '', issuer), { headers: { cookie } });

    expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });

  it('lists the file tool only for an app that can hand over files', async () => {
    const toolsFor = async (clientId: string, redirectUri: string) => {
      const verifier = 'v'.repeat(43);
      const start = server.oauth.startAuthorization(
        new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: redirectUri,
          code_challenge: createHash('sha256').update(verifier).digest('base64url'),
          code_challenge_method: 'S256',
        }),
        undefined,
      );
      if (start.kind !== 'consent') throw new Error(start.kind);
      const decision = server.oauth.decide(start.requestId, start.browserKey, true);
      if (decision.kind !== 'redirect') throw new Error(decision.message);
      const code = new URL(decision.location).searchParams.get('code') ?? '';
      const grant = server.oauth.token(
        new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri, code_verifier: verifier }),
        '203.0.113.9',
      );
      if (grant.status !== 200) throw new Error(grant.body.error);

      const response = await fetch(`${issuer}/mcp`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${grant.body.access_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: '{"jsonrpc":"2.0","id":1,"method":"tools/list"}',
      });
      const { result } = (await response.json()) as { result: { tools: Array<{ name: string; _meta?: Record<string, unknown> }> } };
      return result.tools;
    };

    const claudeCode = await toolsFor(CLAUDE_CODE, 'http://127.0.0.1:53682/callback');
    const chatgpt = await toolsFor('https://chatgpt.com/oauth/client.json', 'https://chatgpt.com/connector_platform_oauth_redirect');

    expect(claudeCode.map((tool) => tool.name)).not.toContain('add_pictures_to_post');
    expect(chatgpt.find((tool) => tool.name === 'add_pictures_to_post')?._meta).toEqual({ 'openai/fileParams': ['pictures'] });
  });
});
