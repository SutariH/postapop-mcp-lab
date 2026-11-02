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
const USER_IN_LINK = /[a-z][a-z0-9+.-]*:[\\/]{2}[^\s/\\?#@]+@/i;

/** A link with a scheme, anywhere in a text. A backslash counts as a slash, as the URL parser reads it. */
const SCHEME_LINK = /[a-z][a-z0-9+.-]*:[\\/]{2}[^\s<>"'()[\]{}]+/gi;

/** A path into a file store's private objects. */
const STORAGE_PATH = /\/(?:object\/sign|object\/authenticated|storage\/v\d+)\//i;

/** Tabs and line breaks. The URL parser drops them, so a check must drop them too. */
const DROPPED_BY_PARSER = /[\t\n\r]/g;

function decodePath(path: string) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The check on a PARSED link: what the URL parser read, not what the text
 * looks like. A user name or password, a storage path, or a credential name
 * in the query or in the fragment.
 */
function isPrivateUrl(url: URL) {
  if (url.username || url.password) return true;
  if (STORAGE_PATH.test(decodePath(url.pathname))) return true;

  const names = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  return names.some(isCredentialName);
}

function parse(text: string) {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

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
  const clean = text.normalize('NFKC').replace(INVISIBLE, '').replace(DROPPED_BY_PARSER, '');

  if (USER_IN_LINK.test(clean)) return true;
  for (const [, name] of clean.matchAll(PARAM_NAME)) {
    if (name && isCredentialName(name)) return true;
  }
  // Read every link in the text the way the URL parser reads it.
  for (const [link] of clean.matchAll(SCHEME_LINK)) {
    const url = parse(link);
    if (url && isPrivateUrl(url)) return true;
  }
  return false;
}

/** Put in place of a private link inside a text. */
export const PRIVATE_LINK_REMOVED = '[private link removed]';

/**
 * A text with every private link inside it replaced. A summary, a takeaway
 * or a saved text can hold a link too, not only the url field. Each word
 * (split at spaces and line breaks, so a tab stays inside its link) that
 * holds a private link is replaced whole; a full stop or comma after it
 * stays. Run it after cleanOutsideText and BEFORE you cut the text into
 * parts: a link cut in two halves is no longer found.
 */
export function redactPrivateLinks(text: string) {
  return text.replace(/[^ \n\r]+/g, (word) => {
    const [, core = word, after = ''] = /^(.*?)([.,;:!?]*)$/s.exec(word) ?? [];
    return holdsPrivateLink(core) ? `${PRIVATE_LINK_REMOVED}${after}` : word;
  });
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
 *
 * Parse first, then check the PARSED link, because that is what leaves. A
 * check on the text alone can disagree with the parser: the parser reads a
 * backslash as a slash, drops tabs, decodes names and rewrites hosts.
 */
export function safeUrl(url: string | null) {
  if (url === null) return null;

  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return null;
  if (isPrivateUrl(parsed) || holdsPrivateLink(url) || holdsPrivateLink(parsed.href)) return null;

  return parsed.href;
}
