// Private links never leave the server. A signed link to a file (a price
// list in cloud storage, for example) works for anyone who has it, for as
// long as it is valid. It is a key, not an address. The model does not need
// it, and anything the model reads can end up in a chat, a log or a post.
//
// One rule for every link and every title that leaves: holdsPrivateLink.

import { INVISIBLE } from './outside-text.js';

/** Query or fragment names that carry a credential or a signature. */
const CREDENTIAL_NAMES = new Set([
  'token',
  'access_token',
  'id_token',
  'refresh_token',
  'auth',
  'authorization',
  'apikey',
  'api_key',
  'key',
  'password',
  'secret',
  'signature',
  'sig',
]);
/** Name prefixes of signed cloud-storage links. */
const CREDENTIAL_PREFIXES = ['x-amz-', 'x-goog-'];

/**
 * `name=` after `?`, `&`, `;` or `#`. It finds a name anywhere in a text,
 * also when the link around it would not parse: inside markdown, in a
 * fragment (`#access_token=`), or HTML-escaped (`&amp;sig=` has `;sig=`).
 */
const PARAM_NAME = /[?&;#]([^=&;#?\s]+)=/g;

/** A user name or password in a link: `https://user:pass@host`. */
const USER_IN_LINK = /[a-z][a-z0-9+.-]*:\/\/[^\s/?#@]+@/i;

function isCredentialName(raw: string) {
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // Not percent-encoded; use it as it is.
  }
  name = name.toLowerCase();
  return CREDENTIAL_NAMES.has(name) || CREDENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * True when a text is, or holds, a link that is a key: a credential or a
 * signature in its query or fragment, or a user name in the link. Read after
 * NFKC and without invisible characters, so neither can hide a name.
 */
export function holdsPrivateLink(text: string) {
  const clean = text.normalize('NFKC').replace(INVISIBLE, '');

  if (USER_IN_LINK.test(clean)) return true;
  for (const [, name] of clean.matchAll(PARAM_NAME)) {
    if (name && isCredentialName(name)) return true;
  }
  return false;
}

/** Shown instead of a title that is, or holds, a private link. */
export const SAVED_LINK_TITLE = 'Saved link';

/**
 * A title as the model may see it. People often save a link without a title,
 * so the product stores the link as the title. Then the title is a key too.
 * The whole title is replaced: a title with the signature cut out would
 * still show where the file is.
 */
export function safeTitle(title: string) {
  return holdsPrivateLink(title) ? SAVED_LINK_TITLE : title;
}

/**
 * A link as the model may see it: a public http or https address, or null.
 * A private link is refused whole. A link with the signature cut out would
 * look public but not work, and it would still show where the file is.
 */
export function safeUrl(url: string | null) {
  if (url === null || holdsPrivateLink(url)) return null;

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}
