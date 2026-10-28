import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, type LookupFunction } from 'node:net';
import { ApiError, type PictureFile } from '../scheduling-api.js';

/**
 * Downloads a file that the chat client handed over. The download_url came
 * from the model's tool call, so treat it as hostile, even inside a file
 * object: anyone who can steer the model can put any address there.
 */

/** The chat client's file store. Read the real host from what the client really sends (a spike), not from a guess. */
export const FILE_HOST = /^[a-z0-9-]+\.files\.example$/;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const DOWNLOAD_TIMEOUT_MS = 20_000;

const NOT_A_CHAT_FILE = 'This is not a file from this chat. Attach the picture to the chat, or make it in the chat, and try again. Do not send a link.';
const DOWNLOAD_FAILED = 'The picture could not be downloaded from the chat. Its link may have expired: links last only a few minutes. Send the picture again.';

interface DownloaderOptions {
  maxBytes?: number;
  timeoutMs?: number;
  /**
   * For tests only: send every download to a local stand-in file store,
   * such as http://127.0.0.1:4555. Refused in production and for any host
   * that is not this computer.
   */
  standInBase?: string;
  env?: Record<string, string | undefined>;
  /** For tests: answers DNS questions instead of the real resolver. */
  resolve?: (hostname: string) => Promise<LookupAddress[]>;
}

export function createFileDownloader({ maxBytes = MAX_FILE_BYTES, timeoutMs = DOWNLOAD_TIMEOUT_MS, standInBase, env = process.env, resolve = resolveAll }: DownloaderOptions = {}) {
  const standIn = standInBase === undefined ? undefined : checkStandIn(standInBase, env);
  const lookup = guardedLookup(resolve);

  return async function download(file: PictureFile, signal: AbortSignal) {
    const url = checkFileUrl(file.downloadUrl);
    // The stand-in keeps only the path and query of the real link, set as
    // parts: a path such as "//other.example/x" cannot change the host.
    const target = standIn ? Object.assign(new URL(standIn), { pathname: url.pathname, search: url.search }) : url;
    try {
      return await fetchCapped(target, { lookup: standIn ? undefined : lookup, maxBytes, timeoutMs, signal });
    } catch (error) {
      // Log the host and the file id, never the link: it is a signed secret.
      console.error(`Download failed: host=${url.hostname} file_id=${JSON.stringify(file.fileId)} reason=${(error as Error).message}`);
      if (error instanceof ApiError) throw error;
      throw new ApiError('download_failed', DOWNLOAD_FAILED);
    }
  };
}

/** https, the exact file-store host as URL parses it, no port, no user name. */
export function checkFileUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError('not_a_chat_file', NOT_A_CHAT_FILE);
  }
  if (url.protocol !== 'https:' || !FILE_HOST.test(url.hostname) || url.port || url.username || url.password) {
    throw new ApiError('not_a_chat_file', NOT_A_CHAT_FILE);
  }
  return url;
}

function checkStandIn(base: string, env: Record<string, string | undefined>) {
  if (env.NODE_ENV === 'production') {
    throw new Error('The stand-in file store is for tests only and is refused in production.');
  }
  const url = new URL(base);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error('The stand-in file store must run on this computer (http://127.0.0.1:<port>).');
  }
  return url.origin;
}

const privateV4 = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) privateV4.addSubnet(network, prefix, 'ipv4');

// For IPv6, allow only global unicast (2000::/3) instead of listing what to
// refuse: loopback, link-local, private, multicast and old forms are all
// outside it. Inside it, refuse Teredo and the documentation range.
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const refusedGlobalV6 = new BlockList();
refusedGlobalV6.addSubnet('2001::', 32, 'ipv6');
refusedGlobalV6.addSubnet('2001:db8::', 32, 'ipv6');

/** True for addresses inside your own network or this computer, which a download must never reach. */
export function isPrivateAddress(address: string, family: number) {
  if (family !== 6) return privateV4.check(address, 'ipv4');
  // An IPv6 address can carry an IPv4 address inside it, in several forms.
  // Check that IPv4 address, whatever the notation.
  const inner = embeddedIPv4(address);
  if (inner !== undefined) return privateV4.check(inner, 'ipv4');
  return !globalV6.check(address, 'ipv6') || refusedGlobalV6.check(address, 'ipv6');
}

/** The IPv4 address inside a mapped, compatible, NAT64 or 6to4 IPv6 address. */
function embeddedIPv4(address: string) {
  const h = hextets(address);
  if (!h) return '0.0.0.0'; // cannot read it: treat it as private
  const v4 = (high: number, low: number) => `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  const zeros = (from: number, to: number) => h.slice(from, to).every((part) => part === 0);
  if (zeros(0, 5) && (h[5] === 0xffff || h[5] === 0)) return v4(h[6]!, h[7]!); // ::ffff:a.b.c.d and ::a.b.c.d
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return v4(h[6]!, h[7]!); // NAT64 64:ff9b::/96
  if (h[0] === 0x64 && h[1] === 0xff9b && h[2] === 1) return '0.0.0.0'; // local NAT64 64:ff9b:1::/48
  if (h[0] === 0x2002) return v4(h[1]!, h[2]!); // 6to4 2002:aabb:ccdd::/48
  return undefined;
}

/** The eight 16-bit parts of an IPv6 address, or undefined if it cannot be read. */
function hextets(address: string) {
  let text = (address.split('%')[0] ?? '').toLowerCase();
  const tail: number[] = [];
  const dotted = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (dotted) {
    const [a, b, c, d] = dotted.slice(1).map(Number) as [number, number, number, number];
    if ([a, b, c, d].some((part) => part > 255)) return undefined;
    tail.push((a << 8) | b, (c << 8) | d);
    text = text.slice(0, -dotted[0].length);
    if (text.endsWith(':') && !text.endsWith('::')) text = text.slice(0, -1);
  }
  const parse = (part: string) => (part === '' ? [] : part.split(':').map((group) => (/^[0-9a-f]{1,4}$/.test(group) ? parseInt(group, 16) : NaN)));
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const left = parse(halves[0] ?? '');
  const right = halves.length === 2 ? parse(halves[1] ?? '') : [];
  const fill = halves.length === 2 ? 8 - tail.length - left.length - right.length : 0;
  if (fill < 0) return undefined;
  const parts = [...left, ...Array<number>(fill).fill(0), ...right, ...tail];
  return parts.length === 8 && parts.every((part) => Number.isInteger(part)) ? parts : undefined;
}

function resolveAll(hostname: string) {
  return new Promise<LookupAddress[]>((resolve, reject) => {
    dnsLookup(hostname, { all: true }, (error, addresses) => (error ? reject(error) : resolve(addresses)));
  });
}

/**
 * Resolves the host ONCE and connects to exactly the addresses it checked.
 * Checking the address and then letting the connection resolve again would
 * let a DNS server answer "public" first and "private" second (DNS rebinding).
 */
function guardedLookup(resolve: (hostname: string) => Promise<LookupAddress[]>): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || addresses.some(({ address, family }) => isPrivateAddress(address, family))) {
          return callback(new Error('the host points to a private address'), '', 4);
        }
        if (options.all) return (callback as unknown as (error: null, list: LookupAddress[]) => void)(null, addresses);
        const [first] = addresses;
        callback(null, first!.address, first!.family);
      },
      (error: NodeJS.ErrnoException) => callback(error, '', 4),
    );
  };
}

function fetchCapped(url: URL, { lookup, maxBytes, timeoutMs, signal }: { lookup: LookupFunction | undefined; maxBytes: number; timeoutMs: number; signal: AbortSignal }) {
  return new Promise<Buffer>((resolve, reject) => {
    const options: RequestOptions = { method: 'GET', signal, ...(lookup ? { lookup } : {}) };
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = send(url, options, (res) => {
      // Never follow a redirect: it could point anywhere.
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`status ${res.statusCode}`));
      }
      if (Number(res.headers['content-length'] ?? 0) > maxBytes) {
        req.destroy();
        return reject(tooLarge(maxBytes));
      }
      // The cap counts the bytes as they arrive. A missing or false
      // Content-Length cannot get more through.
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          reject(tooLarge(maxBytes));
        } else {
          chunks.push(chunk);
        }
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    const timer = setTimeout(() => req.destroy(new Error('timeout')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', reject);
    req.end();
  });
}

const tooLarge = (maxBytes: number) =>
  new ApiError('too_large', `This file is larger than ${Math.round(maxBytes / 1024 / 1024) || maxBytes} ${maxBytes >= 1024 * 1024 ? 'MB' : 'bytes'}. Send a smaller picture.`);
