/**
 * The apps this server knows. Each app identifies itself with a Client ID
 * Metadata Document: its client_id is an https URL that serves a small JSON
 * file with its name and redirect URIs.
 *
 * A production server fetches that document (safely: see "Fetching client
 * documents" in the README). This lab keeps a copy of the redirect URIs from
 * each real document instead, read on 2026-10-28, so it never fetches.
 *
 * The name on the consent screen comes from this list, never from the
 * document's client_name: anyone can write any name in their own document.
 */
export interface KnownClient {
  clientId: string;
  name: string;
  redirectUris: string[];
  /** Native apps listen on a loopback port they pick at run time (RFC 8252), so the port is not compared. */
  loopback: boolean;
  /** Sites whose pages may open the sign-in. A link clicked on any other site is refused. */
  startHosts: string[];
}

export const KNOWN_CLIENTS: KnownClient[] = [
  {
    clientId: 'https://claude.ai/oauth/claude-code-client-metadata',
    name: 'Claude Code',
    redirectUris: ['http://localhost/callback', 'http://127.0.0.1/callback'],
    loopback: true,
    startHosts: [], // Claude Code opens the browser itself, so no page links here.
  },
  {
    clientId: 'https://chatgpt.com/oauth/client.json',
    name: 'ChatGPT',
    redirectUris: ['https://chatgpt.com/connector_platform_oauth_redirect'],
    loopback: false,
    startHosts: ['chatgpt.com'],
  },
];

export function findClient(clientId: string | null) {
  return KNOWN_CLIENTS.find((client) => client.clientId === clientId);
}

/** Exact match, except that a loopback client may use any port. */
export function isAllowedRedirect(client: KnownClient, redirectUri: string) {
  if (client.redirectUris.includes(redirectUri)) {
    return true;
  }
  if (!client.loopback) {
    return false;
  }

  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || url.username || url.password || url.search || url.hash) {
    return false;
  }
  url.port = '';
  return client.redirectUris.includes(url.href);
}

/** True when every redirect URI stays on the person's own computer. The consent page warns about this. */
export function isLoopbackOnly(client: KnownClient) {
  return client.redirectUris.every((uri) => {
    const { hostname } = new URL(uri);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  });
}
