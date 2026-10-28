import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * An opaque, random secret: 256 bits, URL-safe. The prefix shows a person
 * (and a secret scanner) what kind of secret it is.
 */
export function newSecret(prefix: 'lab_code' | 'lab_at' | 'lab_rt' | 'lab_browser') {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

/**
 * The server stores only a hash of each secret, so a copy of its memory (or,
 * in a real product, its database) does not hold working keys. Production
 * uses an HMAC with a server-side key here.
 */
export function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('base64url');
}

/** PKCE S256 (RFC 7636): the verifier must hash to the challenge sent at the start. */
export function matchesChallenge(verifier: string, challenge: string) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
    return false;
  }
  const computed = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
  const expected = Buffer.from(challenge);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}
