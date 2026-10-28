import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { checkFileUrl, createFileDownloader, isPrivateAddress } from '../src/pictures/download-file.js';

const LINK = 'https://eu1.files.example/f/file_abc/picture.png?sig=SECRET-SIGNATURE';
const file = (downloadUrl: string) => ({ downloadUrl, fileId: 'file_abc' });
const signal = () => new AbortController().signal;

describe('the download link', () => {
  it('must be https on the file store, as URL parses it', () => {
    expect(checkFileUrl(LINK).hostname).toBe('eu1.files.example');
  });

  it.each([
    ['plain http', 'http://eu1.files.example/f/x'],
    ['another host', 'https://files.example.evil.test/f/x'],
    ['the store as a user name', 'https://eu1.files.example@evil.test/f/x'],
    ['a user name', 'https://me@eu1.files.example/f/x'],
    ['a port', 'https://eu1.files.example:8443/f/x'],
    ['a private address', 'https://10.0.0.5/f/x'],
    ['the metadata service', 'http://169.254.169.254/latest/meta-data/'],
    ['not a link', 'file:///etc/passwd'],
  ])('refuses %s', (_case, link) => {
    expect(() => checkFileUrl(link)).toThrow(/not a file from this chat/);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    ['127.0.0.1', 4, true],
    ['10.1.2.3', 4, true],
    ['172.20.0.1', 4, true],
    ['192.168.1.10', 4, true],
    ['169.254.169.254', 4, true],
    ['::1', 6, true],
    ['::ffff:127.0.0.1', 6, true],
    ['fd00::1', 6, true],
    ['::ffff:7f00:1', 6, true],
    ['::127.0.0.1', 6, true],
    ['64:ff9b::7f00:1', 6, true],
    ['64:ff9b:1::1', 6, true],
    ['2002:7f00:1::1', 6, true],
    ['2001:0:4136:e378::1', 6, true],
    ['2001:db8::1', 6, true],
    ['fec0::1', 6, true],
    ['ff02::1', 6, true],
    ['100::1', 6, true],
    ['93.184.216.34', 4, false],
    ['2606:4700::1111', 6, false],
    ['2002:5db8:d822::1', 6, false],
  ])('%s is private: %s', (address, family, expected) => {
    expect(isPrivateAddress(address as string, family as number)).toBe(expected);
  });
});

describe('the protected download path', () => {
  const tryWith = async (addresses: Array<{ address: string; family: number }>) => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const download = createFileDownloader({ resolve: async () => addresses, timeoutMs: 2000 });
    const outcome = await download(file(LINK), signal()).catch((error: Error) => error);
    const line = log.mock.calls.flat().join(' ');
    log.mockRestore();
    return { outcome, line };
  };

  it('refuses a file-store host that resolves to a private address', async () => {
    const { outcome, line } = await tryWith([{ address: '127.0.0.1', family: 4 }]);
    expect(outcome).toBeInstanceOf(Error);
    expect(line).toContain('private address');
  });

  it('refuses it when only one of several addresses is private', async () => {
    const { line } = await tryWith([
      { address: '93.184.216.34', family: 4 },
      { address: '64:ff9b::a9fe:a9fe', family: 6 },
    ]);
    expect(line).toContain('private address');
  });
});

describe('the stand-in file store for tests', () => {
  it('is refused in production and anywhere but this computer', () => {
    expect(() => createFileDownloader({ standInBase: 'http://127.0.0.1:4555', env: { NODE_ENV: 'production' } })).toThrow(/refused in production/);
    expect(() => createFileDownloader({ standInBase: 'http://files.internal:4555', env: {} })).toThrow(/must run on this computer/);
  });
});

describe('downloading through the stand-in', () => {
  let server: Server;
  let base: string;
  const seen: Array<{ host?: string; path?: string }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ host: req.headers.host, path: req.url });
      if (req.url?.startsWith('/redirect')) {
        res.writeHead(302, { Location: 'http://169.254.169.254/' }).end();
      } else if (req.url?.startsWith('/big')) {
        res.writeHead(200); // no Content-Length: the cap must count the bytes
        res.write(Buffer.alloc(600));
        res.end(Buffer.alloc(600));
      } else if (req.url?.startsWith('/declared')) {
        res.writeHead(200, { 'Content-Length': '5000' });
        res.write(Buffer.alloc(10));
      } else if (req.url?.startsWith('/trickle')) {
        res.writeHead(200);
        const drip = setInterval(() => res.write('x'), 20);
        res.on('close', () => clearInterval(drip));
      } else if (req.url?.startsWith('/slow')) {
        setTimeout(() => res.writeHead(200).end('late'), 300);
      } else if (req.url?.startsWith('/gone')) {
        res.writeHead(403).end();
      } else {
        res.writeHead(200).end('picture bytes');
      }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const download = (options = {}) => createFileDownloader({ standInBase: base, env: {}, ...options });

  it('downloads the bytes', async () => {
    const bytes = await download()(file(LINK), signal());
    expect(bytes.toString()).toBe('picture bytes');
  });

  it('keeps a path that starts with // on the stand-in', async () => {
    await download()(file('https://eu1.files.example//evil.test/x'), signal());
    expect(seen.at(-1)).toMatchObject({ host: base.replace('http://', ''), path: '//evil.test/x' });
  });

  it('never follows a redirect', async () => {
    await expect(download()(file('https://eu1.files.example/redirect'), signal())).rejects.toThrow(/could not be downloaded/);
  });

  it('counts the bytes as they arrive, with no Content-Length', async () => {
    await expect(download({ maxBytes: 1000 })(file('https://eu1.files.example/big'), signal())).rejects.toThrow(/larger than 1000 bytes/);
  });

  it('refuses a stated size over the cap before reading the body', async () => {
    await expect(download({ maxBytes: 1000 })(file('https://eu1.files.example/declared'), signal())).rejects.toThrow(/larger than 1000 bytes/);
  });

  it('stops a body that trickles in, at the timeout for the whole download', async () => {
    await expect(download({ timeoutMs: 100 })(file('https://eu1.files.example/trickle'), signal())).rejects.toThrow(/could not be downloaded/);
  });

  it('stops after the timeout', async () => {
    await expect(download({ timeoutMs: 50 })(file('https://eu1.files.example/slow'), signal())).rejects.toThrow(/could not be downloaded/);
  });

  it('logs the host and the file id, never the signed link', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(download()(file('https://eu1.files.example/gone?sig=SECRET-SIGNATURE'), signal())).rejects.toThrow(/expired/);

    const line = log.mock.calls.flat().join(' ');
    log.mockRestore();
    expect(line).toContain('host=eu1.files.example');
    expect(line).toContain('file_abc');
    expect(line).not.toContain('SECRET-SIGNATURE');
  });
});
