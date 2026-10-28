import { randomUUID } from 'node:crypto';
import { findClient, isAllowedRedirect, type KnownClient } from './clients.js';
import { resourceUrl, SCOPE } from './metadata.js';
import { hashSecret, matchesChallenge, newSecret } from './tokens.js';

export const REQUEST_TTL_MS = 10 * 60_000; // time to press Allow
export const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_GRACE_MS = 10_000;
export const FAILURE_WINDOW_MS = 10 * 60_000;
export const FAILURE_LIMIT = 20;

interface PendingRequest {
  client: KnownClient;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  browserKeyHash: string;
  expiresAt: number;
}

interface CodeRecord {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: number;
  /** Set when the code was swapped once. A second swap cancels this grant. */
  grantId: string | null;
}

/** One connection: one person allowed one app. Every key below belongs to a grant. */
interface Grant {
  id: string;
  clientId: string;
  revoked: boolean;
  refreshHash: string;
  /** Every refresh key this grant ever had, with the time it was replaced. Kept while the grant lives. */
  replaced: Map<string, number>;
}

interface AccessRecord {
  grantId: string;
  resource: string;
  expiresAt: number;
}

export type TokenResponse =
  | { status: 200; body: { access_token: string; token_type: 'Bearer'; expires_in: number; refresh_token: string; scope: string } }
  | { status: 400 | 401 | 429; body: { error: string; error_description: string } };

export type StartResult =
  | { kind: 'consent'; requestId: string; browserKey: string }
  /** The error goes back to the app, because the redirect URI is known to be the app's. */
  | { kind: 'redirect'; location: string }
  /** The error is shown to the person: never redirect to an address we could not check. */
  | { kind: 'error'; message: string };

export type DecisionResult = { kind: 'redirect'; location: string } | { kind: 'error'; message: string };

/**
 * The sign-in logic, kept apart from HTTP so the tests can drive it directly.
 * Everything lives in memory: restart the server and every connection is gone.
 */
export class OAuthServer {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly codes = new Map<string, CodeRecord>();
  private readonly grants = new Map<string, Grant>();
  private readonly refreshIndex = new Map<string, string>(); // refresh hash -> grant id, current and replaced
  private readonly access = new Map<string, AccessRecord>();
  private readonly failures = new Map<string, number[]>();

  constructor(
    readonly issuer: string,
    private readonly now: () => number = Date.now,
  ) {}

  get resource() {
    return resourceUrl(this.issuer);
  }

  /** GET /authorize. Checks the app first: errors before that point are shown, not redirected. */
  startAuthorization(params: URLSearchParams, referer: string | undefined): StartResult {
    this.sweep();
    const client = findClient(params.get('client_id'));
    if (!client) {
      return { kind: 'error', message: 'This app is not on the list of apps that may connect to this server.' };
    }
    const redirectUri = params.get('redirect_uri') ?? '';
    if (!isAllowedRedirect(client, redirectUri)) {
      return { kind: 'error', message: `The return address is not one that ${client.name} uses.` };
    }
    if (referer && !this.isAllowedStartPage(referer, client)) {
      return { kind: 'error', message: 'This sign-in link was opened from another website. Start the connection again in your AI tool.' };
    }

    const state = params.get('state');
    const fail = (error: string, description: string) => {
      const location = new URL(redirectUri);
      location.searchParams.set('error', error);
      location.searchParams.set('error_description', description);
      if (state) location.searchParams.set('state', state);
      location.searchParams.set('iss', this.issuer);
      return { kind: 'redirect' as const, location: location.href };
    };

    if (params.get('response_type') !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported.');
    }
    const codeChallenge = params.get('code_challenge') ?? '';
    if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      return fail('invalid_request', 'PKCE with code_challenge_method=S256 is required.');
    }
    const resource = params.get('resource');
    if (resource !== null && resource !== this.resource) {
      return fail('invalid_target', `This server signs in for ${this.resource} only.`);
    }
    // Scopes other than "posts" (such as offline_access) are ignored: a
    // server may grant fewer scopes than asked for (RFC 6749, section 3.3).

    const requestId = randomUUID();
    const browserKey = newSecret('lab_browser'); // a cookie value only
    this.pending.set(requestId, {
      client,
      redirectUri,
      state,
      codeChallenge,
      browserKeyHash: hashSecret(browserKey),
      expiresAt: this.now() + REQUEST_TTL_MS,
    });
    return { kind: 'consent', requestId, browserKey };
  }

  /** The request behind a consent page, only for the browser that started it. */
  pendingRequest(requestId: string, browserKey: string | undefined) {
    const request = this.pending.get(requestId);
    if (!request || request.expiresAt <= this.now()) {
      return undefined;
    }
    if (!browserKey || hashSecret(browserKey) !== request.browserKeyHash) {
      return undefined;
    }
    return request;
  }

  /** POST /consent/<id>: the person pressed Allow or Deny. */
  decide(requestId: string, browserKey: string | undefined, allow: boolean): DecisionResult {
    const request = this.pendingRequest(requestId, browserKey);
    if (!request) {
      return { kind: 'error', message: 'This sign-in has expired or was started in another browser. Start the connection again in your AI tool.' };
    }
    this.pending.delete(requestId);

    const location = new URL(request.redirectUri);
    if (allow) {
      const code = newSecret('lab_code');
      this.codes.set(hashSecret(code), {
        clientId: request.client.clientId,
        redirectUri: request.redirectUri,
        codeChallenge: request.codeChallenge,
        expiresAt: this.now() + CODE_TTL_MS,
        grantId: null,
      });
      location.searchParams.set('code', code);
    } else {
      location.searchParams.set('error', 'access_denied');
    }
    if (request.state) location.searchParams.set('state', request.state);
    // RFC 9207: tells the app which server answered, against mix-up attacks.
    location.searchParams.set('iss', this.issuer);
    return { kind: 'redirect', location: location.href };
  }

  /** POST /token. Counts only failed requests per IP: a request that would succeed is never refused. */
  token(form: URLSearchParams, ip: string): TokenResponse {
    this.sweep();
    const result = this.grant(form);
    if (result.status === 200) {
      return result;
    }
    if (this.recordFailure(ip) > FAILURE_LIMIT) {
      return {
        status: 429,
        body: { error: 'invalid_request', error_description: 'Too many failed requests from this address. Wait 10 minutes.' },
      };
    }
    return result;
  }

  /** The access check for /mcp. Undefined means "answer 401". */
  verifyAccessToken(token: string) {
    const record = this.access.get(hashSecret(token));
    if (!record || record.expiresAt <= this.now() || record.resource !== this.resource) {
      return undefined;
    }
    const grant = this.grants.get(record.grantId);
    return grant && !grant.revoked ? { grantId: grant.id, clientId: grant.clientId } : undefined;
  }

  private grant(form: URLSearchParams): TokenResponse {
    const client = findClient(form.get('client_id'));
    if (!client) {
      return error(401, 'invalid_client', 'Unknown client_id.');
    }
    const resource = form.get('resource');
    if (resource !== null && resource !== this.resource) {
      return error(400, 'invalid_target', `This server issues keys for ${this.resource} only.`);
    }

    switch (form.get('grant_type')) {
      case 'authorization_code':
        return this.swapCode(form, client);
      case 'refresh_token':
        return this.refresh(form, client);
      default:
        return error(400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
    }
  }

  private swapCode(form: URLSearchParams, client: KnownClient): TokenResponse {
    const codeHash = hashSecret(form.get('code') ?? '');
    const record = this.codes.get(codeHash);
    if (record?.grantId) {
      // A code works once. A second use, even a late one, means someone else
      // may have it, so cancel everything the first use made (RFC 9700, 4.2.4).
      this.revoke(record.grantId);
      return error(400, 'invalid_grant', 'The code was already used. The connection it made is cancelled.');
    }
    if (!record || record.expiresAt <= this.now() || record.clientId !== client.clientId) {
      return error(400, 'invalid_grant', 'The code is unknown, expired or for another app.');
    }
    if (form.get('redirect_uri') !== record.redirectUri) {
      return error(400, 'invalid_grant', 'redirect_uri must be the same as in the authorization request.');
    }
    if (!matchesChallenge(form.get('code_verifier') ?? '', record.codeChallenge)) {
      return error(400, 'invalid_grant', 'The PKCE code_verifier does not match the code_challenge.');
    }

    const refreshToken = newSecret('lab_rt');
    const grant: Grant = {
      id: randomUUID(),
      clientId: client.clientId,
      revoked: false,
      refreshHash: hashSecret(refreshToken),
      replaced: new Map(),
    };
    this.grants.set(grant.id, grant);
    this.refreshIndex.set(grant.refreshHash, grant.id);
    record.grantId = grant.id;
    return this.issue(grant, refreshToken);
  }

  private refresh(form: URLSearchParams, client: KnownClient): TokenResponse {
    const presented = hashSecret(form.get('refresh_token') ?? '');
    const grant = this.grants.get(this.refreshIndex.get(presented) ?? '');
    if (!grant || grant.revoked || grant.clientId !== client.clientId) {
      return error(400, 'invalid_grant', 'The refresh token is unknown or cancelled.');
    }

    const replacedAt = grant.replaced.get(presented);
    if (replacedAt !== undefined) {
      if (this.now() - replacedAt <= REFRESH_GRACE_MS) {
        // Two refreshes at once (a retry, two tabs). Refuse this one, but do
        // not cancel the connection, and never hand out a second pair.
        return error(400, 'invalid_grant', 'This refresh token was just replaced. Use the new one.');
      }
      // An old refresh token came back: it was stolen, or a copy leaked.
      // Cancel the whole connection (RFC 9700, section 4.14.2).
      this.revoke(grant.id);
      return error(400, 'invalid_grant', 'This refresh token was already used. The connection is cancelled; sign in again.');
    }

    const refreshToken = newSecret('lab_rt');
    grant.replaced.set(presented, this.now());
    grant.refreshHash = hashSecret(refreshToken);
    this.refreshIndex.set(grant.refreshHash, grant.id);
    return this.issue(grant, refreshToken);
  }

  private issue(grant: Grant, refreshToken: string): TokenResponse {
    const accessToken = newSecret('lab_at');
    this.access.set(hashSecret(accessToken), {
      grantId: grant.id,
      resource: this.resource, // RFC 8707: this key works only at this server
      expiresAt: this.now() + ACCESS_TTL_MS,
    });
    return {
      status: 200,
      body: {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TTL_MS / 1000,
        refresh_token: refreshToken,
        scope: SCOPE,
      },
    };
  }

  /**
   * Forgets what has expired, so memory does not grow forever. A real server
   * deletes expired rows on a schedule. Grants stay: their refresh history
   * must live as long as the connection.
   */
  private sweep() {
    const now = this.now();
    for (const [id, request] of this.pending) if (request.expiresAt <= now) this.pending.delete(id);
    for (const [hash, code] of this.codes) if (code.expiresAt <= now && !code.grantId) this.codes.delete(hash);
    for (const [hash, record] of this.access) if (record.expiresAt <= now) this.access.delete(hash);
    for (const [ip, times] of this.failures) if (times.every((time) => time <= now - FAILURE_WINDOW_MS)) this.failures.delete(ip);
  }

  private revoke(grantId: string) {
    const grant = this.grants.get(grantId);
    if (grant) grant.revoked = true;
  }

  private recordFailure(ip: string) {
    const since = this.now() - FAILURE_WINDOW_MS;
    const recent = (this.failures.get(ip) ?? []).filter((time) => time > since);
    recent.push(this.now());
    this.failures.set(ip, recent);
    return recent.length;
  }

  private isAllowedStartPage(referer: string, client: KnownClient) {
    try {
      const { host, origin } = new URL(referer);
      return origin === new URL(this.issuer).origin || client.startHosts.includes(host);
    } catch {
      return false;
    }
  }
}

function error(status: 400 | 401, code: string, description: string): TokenResponse {
  return { status, body: { error: code, error_description: description } };
}
