/**
 * The two discovery documents. A client finds the first one through the
 * WWW-Authenticate header of a 401, and the second one through the first.
 */

export const SCOPE = 'posts';

export function resourceUrl(issuer: string) {
  return `${issuer}/mcp`;
}

/** Protected Resource Metadata (RFC 9728): "this server is protected, sign in there". */
export function protectedResourceMetadata(issuer: string) {
  return {
    // Must equal the URL the person typed into their AI tool, path included.
    resource: resourceUrl(issuer),
    // Clients use only the first entry.
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
    resource_name: 'Postapop demo MCP server',
  };
}

/** Authorization Server Metadata (RFC 8414): what this sign-in server supports. */
export function authorizationServerMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    // Claude uses Client ID Metadata Documents only when BOTH of these are
    // present. Without them it falls back to dynamic client registration,
    // which this server does not offer.
    token_endpoint_auth_methods_supported: ['none'],
    client_id_metadata_document_supported: true,
    scopes_supported: [SCOPE],
    // RFC 9207: every answer to the app carries iss, so the app can check
    // which server answered (against mix-up attacks).
    authorization_response_iss_parameter_supported: true,
  };
}

/** The header on every 401 from /mcp. It is what starts the sign-in in Claude. */
export function wwwAuthenticate(issuer: string, error?: 'invalid_token') {
  const parts = [
    `resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
    // Without scope, Claude asks for every scope the metadata lists.
    `scope="${SCOPE}"`,
  ];
  if (error) {
    parts.push(`error="${error}"`);
  }
  return `Bearer ${parts.join(', ')}`;
}
