// Private links never leave the server. A signed link to a file (a price
// list in cloud storage, for example) works for anyone who has it, for as
// long as it is valid. It is a key, not an address. The model does not need
// it, and anything the model reads can end up in a chat, a log or a post.
//
// Two rules make this safe:
//   1. Parse, then check the parsed form. The link that leaves is the one the
//      URL parser wrote, so the check must read it the same way. A check on
//      the text alone can disagree with the parser: the parser reads a
//      backslash as a slash, accepts "https:host" with no slashes at all,
//      drops tabs, decodes names and rewrites hosts.
//   2. Look inside text, not only in the url field. A title, a summary or a
//      saved text can hold a private link too.

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

/**
 * A link candidate in a text. For http, https, ftp, ws, wss and file, the URL
 * parser accepts any number of slashes or backslashes after the colon, even
 * none: "https:/host", "https:\\host" and "HTTPS:host" all parse. So this
 * pattern accepts them too, and the parser decides what the candidate means.
 * A tab may sit inside a candidate, because the parser drops it.
 */
const LINK_CANDIDATE = /(?:https?|ftp|wss?|file):[\\/]*(?:[^\s<>"'()[\]{}]|\t)+/gi;

/** "user:password@host.name" with no scheme in front. */
const USER_AT_HOST = /(?:^|[^a-z0-9.+-])([^\s:/\\@<>"'()[\]{}]+):[^\s/\\@<>"'()[\]{}]*@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;

/** "@" with something shaped like a host after it. */
const AT_HOST = /\S@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/** A path into a file store's private objects. */
const STORAGE_PATH = /\/(?:object\/sign|object\/authenticated|storage\/v\d+)\//i;

/** Tabs and line breaks. The URL parser drops them, so a check must drop them too. */
const DROPPED_BY_PARSER = /[\t\n\r]/g;

/** A full stop, comma and the like after a link belong to the sentence. */
const TRAILING_PUNCTUATION = /[.,;:!?]+$/;

function decode(text: string) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function isCredentialName(raw: string) {
  const name = decode(raw).toLowerCase();
  return CREDENTIAL_NAMES.has(name) || CREDENTIAL_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function parse(text: string) {
  try {
    return new URL(text);
  } catch {
    return undefined;
  }
}

/**
 * The check on a PARSED link: what the URL parser read, not what the text
 * looks like. A user name or password, a storage path, or a credential name
 * in the query or in the fragment.
 */
function isPrivateUrl(url: URL) {
  if (url.username || url.password) return true;
  if (STORAGE_PATH.test(decode(url.pathname))) return true;

  const names = [...url.searchParams.keys(), ...new URLSearchParams(url.hash.slice(1)).keys()];
  return names.some(isCredentialName);
}

/** A candidate split into the link and the punctuation after it. */
function splitTrailing(candidate: string) {
  const after = TRAILING_PUNCTUATION.exec(candidate)?.[0] ?? '';
  return [candidate.slice(0, candidate.length - after.length), after] as const;
}

/** True when the URL parser reads this candidate as a private link. */
function isPrivateCandidate(candidate: string) {
  const url = parse(splitTrailing(candidate)[0].replace(DROPPED_BY_PARSER, ''));
  return url !== undefined && isPrivateUrl(url);
}

function hasCredentialName(text: string) {
  return [...text.matchAll(PARAM_NAME)].some(([, name]) => name !== undefined && isCredentialName(name));
}

function hasUserAtHost(text: string) {
  return [...text.matchAll(USER_AT_HOST)].some(([, user]) => user?.toLowerCase() !== 'mailto');
}

/** Text as the checks read it: NFKC, without invisible characters. */
function prepare(text: string) {
  return text.normalize('NFKC').replace(INVISIBLE, '');
}

/**
 * True when a text is, or holds, a link that is a key: a credential or a
 * signature in its query or fragment, a user name or password, or a path
 * into a file store. Every link candidate is read by the URL parser.
 */
export function holdsPrivateLink(text: string) {
  const clean = prepare(text).replace(DROPPED_BY_PARSER, '');

  if (hasCredentialName(clean) || hasUserAtHost(clean)) return true;
  return [...clean.matchAll(LINK_CANDIDATE)].some(([candidate]) => isPrivateCandidate(candidate));
}

/** Put in place of a private link inside a text. */
export const PRIVATE_LINK_REMOVED = '[private link removed]';

/**
 * A text with every private link inside it replaced. Run it after
 * cleanOutsideText and BEFORE you cut the text into parts: a link cut in two
 * halves is no longer found.
 *
 * A link with a scheme is replaced on its own, so the words around it stay.
 * Then each word (split at spaces and line breaks) that still holds a private
 * link, such as one with no scheme, is replaced whole. A full stop or comma
 * after it stays. A plain email address is not a link, so it stays.
 */
export function redactPrivateLinks(text: string) {
  const withoutLinks = text.replace(LINK_CANDIDATE, (candidate) => {
    const [link, after] = splitTrailing(candidate);
    return isPrivateCandidate(link) || holdsPrivateLink(link) ? `${PRIVATE_LINK_REMOVED}${after}` : candidate;
  });

  return withoutLinks.replace(/[^ \n\r]+/g, (word) => {
    const [core, after] = splitTrailing(word);
    return holdsPrivateLink(core) ? `${PRIVATE_LINK_REMOVED}${after}` : word;
  });
}

/** Shown instead of a title that is, or holds, a private link. */
export const SAVED_LINK_TITLE = 'Saved link';

/**
 * A title as the model may see it. People often save a link without a title,
 * so the product stores the link as the title. Then the title is a key too.
 * The whole title is replaced: a title with the signature cut out would
 * still show where the file is. A title with "@" and a host after it is
 * replaced too: in a title, that is a pasted link or an address, not prose.
 */
export function safeTitle(title: string) {
  return holdsPrivateLink(title) || AT_HOST.test(prepare(title)) ? SAVED_LINK_TITLE : title;
}

/**
 * A link as the model may see it: a public http or https address, or null.
 * Parse first, then check the parsed link, because that is what leaves. A
 * private link is refused whole. A link with the signature cut out would look
 * public but not work, and it would still show where the file is.
 */
export function safeUrl(url: string | null) {
  if (url === null) return null;

  const parsed = parse(url);
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) return null;
  if (isPrivateUrl(parsed) || holdsPrivateLink(url) || holdsPrivateLink(parsed.href)) return null;

  return parsed.href;
}
