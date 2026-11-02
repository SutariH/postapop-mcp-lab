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
//
// Hostile text cannot make a check slow: no pattern can try the same
// characters again from many start points, and each check first looks for
// the one character it needs. No pattern has a length cap either, because a
// cap would let a long user name or password through.

import { INVISIBLE } from './outside-text.js';

/** The longest run of words that redactPrivateLinks checks as one link. */
const MAX_RUN_ON = 4096;

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

/** `name=` at the start of a word, with nothing before it: "token=abc". */
const WORD_NAME = /(?:^|[\s([<"'])([^\s=?&;#()[\]<>"']+)=/g;

/**
 * A user name in a link with any scheme: `s3://user@host`, `https://user:pass@host`.
 * The scheme part may match only the end of a longer scheme, which is enough.
 */
const USER_IN_LINK = /[a-z][a-z0-9+.-]{0,31}:[\\/]{2}[^\s/\\?#@]+@/i;

/**
 * A link with any scheme and two slashes or backslashes: `s3://…`, `https://…`.
 * The URL parser reads each one.
 */
const ANY_SCHEME_LINK = /[a-z][a-z0-9+.-]{0,31}:[\\/]{2}[^\s<>"'()[\]{}]+/gi;

/**
 * A link with a special scheme. For http, https, ftp, ws, wss and file, the
 * URL parser accepts any number of slashes or backslashes after the colon,
 * even none: "https:/host", "https:\\host" and "HTTPS:host" all parse. So
 * this pattern accepts them too, and the parser decides what each one means.
 */
const SPECIAL_SCHEME_LINK = /(?:https?|ftp|wss?|file):[\\/]*[^\s<>"'()[\]{}]+/gi;

/** Characters that end a "user:password@host" shape. */
const SHAPE_BREAK = /[\s/\\<>"'()[\]{}]+/;
/** A host name at the start of a text. */
const HOST_START = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/** "@" with something shaped like a host after it. */
const AT_HOST = /\S@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;

/** A path into a file store's private objects. */
const STORAGE_PATH = /\/(?:object\/sign|object\/authenticated|storage\/v\d+)\//i;

/**
 * Tabs and line breaks. The URL parser drops them, so the link check drops
 * them too. The shape checks read them as spaces, so a line break never
 * glues a name onto the word before it.
 */
const BREAKS = /[\t\n\r]/g;

const SENTENCE_END = '.,;:!?';

/** A word that ends inside a link, so the link may run on into the next word. */
const ENDS_INSIDE_LINK = '?&=/\\#;:@-';

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

/** Text split into what comes before the full stop, comma and the like at its end, and those. */
function splitSentenceEnd(text: string) {
  let end = text.length;
  while (end > 0 && SENTENCE_END.includes(text[end - 1] ?? '')) end -= 1;
  return [text.slice(0, end), text.slice(end)] as const;
}

function isPrivateCandidate(candidate: string) {
  const url = parse(splitSentenceEnd(candidate)[0]);
  return url !== undefined && isPrivateUrl(url);
}

function hasCredentialName(text: string, pattern: RegExp) {
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match[1] !== undefined && isCredentialName(match[1])) return true;
  }
  return false;
}

/**
 * "user:password@host.name" with no scheme in front, of any length. Written
 * as a loop, not a pattern, so a long run of ":" or "@" cannot make it slow.
 * A literal "mailto:" in front of an address is not a user name.
 */
function hasUserAtHost(text: string) {
  for (const shape of text.split(SHAPE_BREAK)) {
    const parts = shape.split('@');
    for (let index = 0; index < parts.length - 1; index += 1) {
      const before = parts[index] ?? '';
      const colon = before.indexOf(':');
      if (colon <= 0) continue;
      const isMailto = before.slice(0, colon).toLowerCase() === 'mailto' && !before.includes(':', colon + 1);
      if (!isMailto && HOST_START.test(parts[index + 1] ?? '')) return true;
    }
  }
  return false;
}

/** Printable ASCII and spaces only: NFKC and the invisible-character step change nothing. */
const PLAIN_ASCII = /^[ -~\s]*$/;

/** Text as the checks read it: NFKC, without invisible characters. */
function prepare(text: string) {
  return PLAIN_ASCII.test(text) ? text : text.normalize('NFKC').replace(INVISIBLE, '');
}

/**
 * True when a text is, or holds, a link that is a key: a credential or a
 * signature in its query or fragment, a user name or password, or a path
 * into a file store. Every link in the text is also read by the URL parser.
 */
export function holdsPrivateLink(text: string) {
  const clean = prepare(text);
  const hasBreaks = /[\t\n\r]/.test(clean);
  // The way the URL parser reads it: tabs and line breaks gone.
  const joined = hasBreaks ? clean.replace(BREAKS, '') : clean;
  // The way a reader sees it: tabs and line breaks are spaces.
  const spaced = hasBreaks ? clean.replace(BREAKS, ' ') : clean;

  // Each check needs one character: "=" for a name, "@" for a user, ":" for a
  // scheme. Most words have none of them, so most checks end here.
  if (!/[:=@]/.test(joined)) return false;

  return (
    hasPrivateShape(spaced) ||
    (joined !== spaced && hasPrivateShape(joined)) ||
    [...joined.matchAll(ANY_SCHEME_LINK), ...joined.matchAll(SPECIAL_SCHEME_LINK)].some(([candidate]) =>
      isPrivateCandidate(candidate),
    )
  );
}

/** The checks on the shape of the text, without the URL parser. */
function hasPrivateShape(text: string) {
  const hasAt = text.includes('@');
  const hasColon = text.includes(':');

  return (
    (text.includes('=') && (hasCredentialName(text, PARAM_NAME) || hasCredentialName(text, WORD_NAME))) ||
    (hasAt && hasColon && (USER_IN_LINK.test(text) || hasUserAtHost(text)))
  );
}

/** Put in place of a private link inside a text. It has no square brackets, so it cannot help to fake a fence marker. */
export const PRIVATE_LINK_REMOVED = '(private link removed)';

/**
 * A text with every private link inside it replaced. Use prepareOutsideText,
 * which runs this between two cleanings, before you cut a text into parts: a
 * link cut in two halves is no longer found.
 *
 * Words are split at spaces only. A tab or line break stays inside its word,
 * and the check drops it, as the URL parser does. A word that ends inside a
 * link (after ?, &, =, / and the like) is checked together with the words
 * after it. Each word, or run of words, that holds a private link is replaced
 * whole, up to the full stop or comma at its end. A plain email address is
 * not a link, so it stays.
 */
export function redactPrivateLinks(text: string) {
  const pieces = text.split(/( +)/); // words at even places, spaces at odd places
  const out: string[] = [];

  for (let start = 0; start < pieces.length; start += 2) {
    let end = start;
    let length = pieces[start]?.length ?? 0;
    while (
      end + 2 < pieces.length &&
      ENDS_INSIDE_LINK.includes(pieces[end]?.at(-1) ?? '') &&
      length + (pieces[end + 2]?.length ?? 0) <= MAX_RUN_ON
    ) {
      end += 2;
      length += pieces[end]?.length ?? 0;
    }

    const words = pieces.slice(start, end + 1).filter((_, index) => index % 2 === 0);
    if (end > start && holdsPrivateLink(words.join(''))) {
      out.push(`${PRIVATE_LINK_REMOVED}${splitSentenceEnd(pieces[end] ?? '')[1]}`);
    } else {
      // Not one link across the words, so check each word on its own.
      for (let index = start; index <= end; index += 1) {
        const piece = pieces[index] ?? '';
        if (index % 2 === 1) {
          out.push(piece);
          continue;
        }
        const [core, after] = splitSentenceEnd(piece);
        out.push(core && holdsPrivateLink(core) ? `${PRIVATE_LINK_REMOVED}${after}` : piece);
      }
    }
    if (end + 1 < pieces.length) out.push(pieces[end + 1] ?? '');
    start = end;
  }

  return out.join('');
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
