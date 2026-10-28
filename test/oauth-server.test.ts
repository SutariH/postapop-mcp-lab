import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorizationServerMetadata, protectedResourceMetadata } from '../src/oauth/metadata.js';
import { FAILURE_LIMIT, OAuthServer, type TokenResponse } from '../src/oauth/oauth-server.js';

const ISSUER = 'https://mcp.example.com';
const CLAUDE_CODE = 'https://claude.ai/oauth/claude-code-client-metadata';
const CHATGPT = 'https://chatgpt.com/oauth/client.json';
const REDIRECT = 'http://127.0.0.1:53682/callback';
const VERIFIER = 'a'.repeat(43) + '-verifier_with~chars.';
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url');

function setup() {
  let time = Date.parse('2026-11-02T12:00:00Z');
  const clock = { advance: (ms: number) => (time += ms) };
  const oauth = new OAuthServer(ISSUER, () => time);
  return { oauth, clock };
}

function authorizeParams(overrides: Record<string, string | null> = {}) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLAUDE_CODE,
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'state-123',
    resource: `${ISSUER}/mcp`,
    scope: 'posts',
  });
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) params.delete(key);
    else params.set(key, value);
  }
  return params;
}

/** Start, press Allow, and return the code from the redirect. */
function getCode(oauth: OAuthServer) {
  const start = oauth.startAuthorization(authorizeParams(), undefined);
  if (start.kind !== 'consent') throw new Error(`expected consent, got ${start.kind}`);
  const decision = oauth.decide(start.requestId, start.browserKey, true);
  if (decision.kind !== 'redirect') throw new Error(decision.message);
  return new URL(decision.location).searchParams.get('code') ?? '';
}

function swap(oauth: OAuthServer, code: string, extra: Record<string, string> = {}) {
  return oauth.token(
    new URLSearchParams({ grant_type: 'authorization_code', client_id: CLAUDE_CODE, code, redirect_uri: REDIRECT, code_verifier: VERIFIER, ...extra }),
    '203.0.113.7',
  );
}

function refresh(oauth: OAuthServer, refreshToken: string) {
  return oauth.token(new URLSearchParams({ grant_type: 'refresh_token', client_id: CLAUDE_CODE, refresh_token: refreshToken }), '203.0.113.7');
}

function tokens(response: TokenResponse) {
  if (response.status !== 200) throw new Error(`${response.status} ${response.body.error}: ${response.body.error_description}`);
  return response.body;
}

describe('discovery documents', () => {
  it('turn on Client ID Metadata Documents the way Claude checks for them', () => {
    const metadata = authorizationServerMetadata(ISSUER);

    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(['none']);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    expect(protectedResourceMetadata(ISSUER)).toMatchObject({ resource: `${ISSUER}/mcp`, authorization_servers: [ISSUER] });
  });
});

describe('authorization request', () => {
  it('shows an error, and never redirects, for an unknown app', () => {
    const { oauth } = setup();
    const result = oauth.startAuthorization(authorizeParams({ client_id: 'https://evil.example/client.json' }), undefined);

    expect(result).toMatchObject({ kind: 'error' });
  });

  it("refuses a return address the app does not use", () => {
    const { oauth } = setup();

    expect(oauth.startAuthorization(authorizeParams({ redirect_uri: 'https://evil.example/callback' }), undefined)).toMatchObject({ kind: 'error' });
    expect(
      oauth.startAuthorization(authorizeParams({ client_id: CHATGPT, redirect_uri: 'https://chatgpt.com/other' }), undefined),
    ).toMatchObject({ kind: 'error' });
  });

  it('lets a loopback app pick any port, but nothing else', () => {
    const { oauth } = setup();

    expect(oauth.startAuthorization(authorizeParams({ redirect_uri: 'http://localhost:61000/callback' }), undefined).kind).toBe('consent');
    expect(oauth.startAuthorization(authorizeParams({ redirect_uri: 'http://127.0.0.1:61000/other' }), undefined).kind).toBe('error');
  });

  it('sends a missing PKCE challenge back to the app as an error', () => {
    const { oauth } = setup();
    const result = oauth.startAuthorization(authorizeParams({ code_challenge: null }), undefined);

    expect(result.kind).toBe('redirect');
    const location = new URL(result.kind === 'redirect' ? result.location : '');
    expect(location.searchParams.get('error')).toBe('invalid_request');
    expect(location.searchParams.get('state')).toBe('state-123');
    expect(location.searchParams.get('iss')).toBe(ISSUER);
  });

  it('ignores scopes it does not have, such as offline_access', () => {
    const { oauth } = setup();

    expect(oauth.startAuthorization(authorizeParams({ scope: 'posts offline_access' }), undefined).kind).toBe('consent');
  });

  it('refuses a sign-in link clicked on another website', () => {
    const { oauth } = setup();

    expect(oauth.startAuthorization(authorizeParams(), 'https://evil.example/page').kind).toBe('error');
    expect(oauth.startAuthorization(authorizeParams({ client_id: CHATGPT, redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect' }), 'https://chatgpt.com/').kind).toBe('consent');
  });

  it('accepts the Allow press only from the browser that started the sign-in', () => {
    const { oauth } = setup();
    const start = oauth.startAuthorization(authorizeParams(), undefined);
    if (start.kind !== 'consent') throw new Error('expected consent');

    expect(oauth.decide(start.requestId, 'lab_browser_someone-else', true).kind).toBe('error');
    expect(oauth.decide(start.requestId, start.browserKey, true).kind).toBe('redirect');
  });

  it('returns access_denied when the person presses Deny', () => {
    const { oauth } = setup();
    const start = oauth.startAuthorization(authorizeParams(), undefined);
    if (start.kind !== 'consent') throw new Error('expected consent');
    const decision = oauth.decide(start.requestId, start.browserKey, false);

    expect(decision.kind === 'redirect' && new URL(decision.location).searchParams.get('error')).toBe('access_denied');
  });
});

describe('authorization code', () => {
  it('becomes an access token and a refresh token', () => {
    const { oauth } = setup();
    const body = tokens(swap(oauth, getCode(oauth)));

    expect(body.access_token).toMatch(/^lab_at_/);
    expect(body.refresh_token).toMatch(/^lab_rt_/);
    expect(body.expires_in).toBe(3600);
    expect(oauth.verifyAccessToken(body.access_token)).toBeDefined();
  });

  it('needs the PKCE verifier that matches the challenge', () => {
    const { oauth } = setup();
    const result = swap(oauth, getCode(oauth), { code_verifier: 'b'.repeat(43) });

    expect(result).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('expires after 60 seconds', () => {
    const { oauth, clock } = setup();
    const code = getCode(oauth);
    clock.advance(61_000);

    expect(swap(oauth, code)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
  });

  it('works once, and a second use cancels what the first use made', () => {
    const { oauth } = setup();
    const code = getCode(oauth);
    const first = tokens(swap(oauth, code));

    expect(swap(oauth, code)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(oauth.verifyAccessToken(first.access_token)).toBeUndefined();
  });

  it('cancels the connection even when the second use comes after the code expired', () => {
    const { oauth, clock } = setup();
    const code = getCode(oauth);
    const first = tokens(swap(oauth, code));
    clock.advance(5 * 60_000);

    swap(oauth, code);
    expect(oauth.verifyAccessToken(first.access_token)).toBeUndefined();
  });
});

describe('access and refresh tokens', () => {
  it('stop working after an hour', () => {
    const { oauth, clock } = setup();
    const body = tokens(swap(oauth, getCode(oauth)));
    clock.advance(60 * 60_000);

    expect(oauth.verifyAccessToken(body.access_token)).toBeUndefined();
  });

  it('rotate: each refresh gives a new pair', () => {
    const { oauth } = setup();
    const first = tokens(swap(oauth, getCode(oauth)));
    const second = tokens(refresh(oauth, first.refresh_token));

    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(oauth.verifyAccessToken(second.access_token)).toBeDefined();
  });

  it('refuse a duplicate refresh within 10 seconds, but keep the connection', () => {
    const { oauth, clock } = setup();
    const first = tokens(swap(oauth, getCode(oauth)));
    const second = tokens(refresh(oauth, first.refresh_token));
    clock.advance(5_000);

    expect(refresh(oauth, first.refresh_token)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(refresh(oauth, second.refresh_token).status).toBe(200);
  });

  it('cancel the whole connection when an old refresh token comes back later', () => {
    const { oauth, clock } = setup();
    const first = tokens(swap(oauth, getCode(oauth)));
    const second = tokens(refresh(oauth, first.refresh_token));
    clock.advance(11_000);

    expect(refresh(oauth, first.refresh_token)).toMatchObject({ status: 400, body: { error: 'invalid_grant' } });
    expect(oauth.verifyAccessToken(second.access_token)).toBeUndefined();
    expect(refresh(oauth, second.refresh_token).status).toBe(400);
  });

  it('remember every replaced refresh token, not only the last one', () => {
    const { oauth, clock } = setup();
    const first = tokens(swap(oauth, getCode(oauth)));
    const second = tokens(refresh(oauth, first.refresh_token));
    const third = tokens(refresh(oauth, second.refresh_token));
    clock.advance(11_000);

    refresh(oauth, first.refresh_token);
    expect(oauth.verifyAccessToken(third.access_token)).toBeUndefined();
  });
});

describe('failure limit', () => {
  it('counts only failed requests, and never blocks one that would succeed', () => {
    const { oauth } = setup();
    for (let attempt = 0; attempt < FAILURE_LIMIT; attempt++) {
      expect(swap(oauth, 'lab_code_guess').status).toBe(400);
    }

    expect(swap(oauth, 'lab_code_guess').status).toBe(429);
    expect(swap(oauth, getCode(oauth)).status).toBe(200);
  });
});
