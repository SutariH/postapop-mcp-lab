import { describe, expect, it } from 'vitest';
import {
  holdsPrivateLink,
  PRIVATE_LINK_REMOVED,
  redactPrivateLinks,
  safeTitle,
  safeUrl,
  SAVED_LINK_TITLE,
} from '../src/material/private-links.js';
import { createDemoApi } from '../src/demo-api.js';
import { sourceParts } from '../src/material/parts.js';
import { callTool, connectClient, NOW } from './helpers.js';

const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const wide = (text: string) => text.replace(/[!-~]/g, (char) => String.fromCodePoint(char.charCodeAt(0) + 0xfee0));

describe('private links', () => {
  it.each([
    ['a signed storage link', 'https://files.example/prices.pdf?X-Amz-Expires=600&X-Amz-Signature=abc'],
    ['a token in the query', 'https://files.example/prices.pdf?token=abc'],
    ['a link inside markdown', 'Prices: [spring list](https://files.example/prices.pdf?sig=abc)'],
    ['a key in the fragment', 'https://app.example/back#access_token=abc'],
    ['an HTML-escaped query', 'https://files.example/prices.pdf?a=1&amp;sig=abc'],
    ['a name after a semicolon', 'https://files.example/prices.pdf;signature=abc'],
    ['a percent-encoded name', 'https://files.example/prices.pdf?%73ig=abc'],
    ['a name split by an invisible character', `https://files.example/prices.pdf?si${ZERO_WIDTH_SPACE}g=abc`],
    ['a name in wide letters', `https://files.example/prices.pdf${wide('?token=abc')}`],
    ['a user name and password', 'https://ann:secret@files.example/prices.pdf'],
  ])('finds %s', (_name, text) => {
    expect(holdsPrivateLink(text)).toBe(true);
    expect(safeTitle(text)).toBe(SAVED_LINK_TITLE);
  });

  it.each([
    'https://greenthumb.example/guides/repot-monstera',
    'https://video.example/watch?v=abc&t=30',
    'How to repot a root-bound monstera',
    'Tips & tricks = a happier fern',
    'Q&A: soil, pots and light',
  ])('leaves an ordinary link or title alone: %s', (text) => {
    expect(holdsPrivateLink(text)).toBe(false);
    expect(safeTitle(text)).toBe(text);
  });

  // The url that leaves is the PARSED one. These links look harmless to a
  // check on the raw text, but the URL parser reads a user name, a password
  // or a credential into them.
  const TAB = String.fromCodePoint(9);
  const BACKSLASH = String.fromCodePoint(92);
  it.each([
    ['backslashes instead of slashes', `https:${BACKSLASH}${BACKSLASH}ann:secret@files.example/prices.pdf`],
    ['a tab inside the password', `https://ann:sec${TAB}ret@files.example/prices.pdf`],
    ['a tab inside a query name', `https://files.example/prices.pdf?to${TAB}ken=abc`],
    ['a percent-encoded query name', 'https://files.example/prices.pdf?%74oken=abc'],
    ['a percent-encoded fragment name', 'https://app.example/back#%61ccess_token=abc'],
    ['an uppercase scheme with a user name', 'HTTPS://ANN:SECRET@FILES.EXAMPLE/prices.pdf'],
    ['a user name on an international host', 'https://ann:secret@b' + String.fromCodePoint(0xfc) + 'cher.example/prices.pdf'],
    ['a signed-object path', 'https://files.example/object/sign/prices.pdf'],
    ['a storage API path', 'https://files.example/storage/v1/object/public/prices.pdf'],
  ])('checks the parsed link, not only the text: %s', (_name, url) => {
    expect(safeUrl(url)).toBeNull();
  });

  it('returns the parsed form of an ordinary link, also on an international host', () => {
    expect(safeUrl('HTTPS://Greenthumb.example/guides')).toBe('https://greenthumb.example/guides');
    expect(safeUrl('https://b' + String.fromCodePoint(0xfc) + 'cher.example/guides')).toBe('https://xn--bcher-kva.example/guides');
  });

  it('refuses a private link whole, and every link that is not http or https', () => {
    expect(safeUrl('https://files.example/prices.pdf?X-Amz-Signature=abc')).toBeNull();
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('ftp://files.example/prices.pdf')).toBeNull();
    expect(safeUrl('not a link')).toBeNull();
    expect(safeUrl(null)).toBeNull();
    expect(safeUrl('https://greenthumb.example/guides/repot-monstera')).toBe('https://greenthumb.example/guides/repot-monstera');
  });
});

describe('a source saved as a signed link', () => {
  it('never shows the link, in any answer', async () => {
    const client = await connectClient();
    const answers = [
      await callTool(client, 'list_sources'),
      await callTool(client, 'get_source', { source_id: 'src_003' }),
      await callTool(client, 'get_post_suggestions', { count: 6 }),
    ];

    for (const { isError, text } of answers) {
      expect(isError).toBe(false);
      expect(text).not.toContain('files.example');
      expect(text).not.toContain('Signature');
    }
    const source = answers[0]?.json.sources.find((candidate: { id: string }) => candidate.id === 'src_003');
    expect(source).toMatchObject({ title: 'Saved link', url: null });
  });

  it('still lets the model read the stored text', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'get_source', { source_id: 'src_003' });

    expect(json.source.title).toBe('Saved link');
    expect(json.text).toContain('Terracotta pots, all sizes: up 8%.');
  });

  it('cannot be found by searching for the hidden link', async () => {
    const client = await connectClient();

    for (const search of ['files.example', 'Signature', 'spring-prices']) {
      const { json } = await callTool(client, 'list_sources', { search });
      expect(json.sources).toEqual([]);
    }
  });
});

describe('a private link inside text', () => {
  const PLACEHOLDER = PRIVATE_LINK_REMOVED;
  const SIGNED = 'https://files.example/a.pdf?X-Amz-Expires=600&X-Amz-Signature=SECRET1';
  const MARKDOWN = '[my order](https://shop.example/orders/1?token=SECRET2)';
  const WITH_USER = 'https://ann:SECRET3@files.example/b.pdf';
  const STORAGE = 'https://files.example/object/sign/SECRET4.pdf';
  // Without the removal, the cut at 2,000 characters falls inside this link,
  // between "?si" and "g=SECRET5", and neither half looks like a private link.
  const ACROSS_THE_CUT = 'https://files.example/c.pdf?sig=SECRET5';
  const longText = `${'Repot in spring. '.repeat(94)}${'a'.repeat(372)}${ACROSS_THE_CUT} ${'Water slowly. '.repeat(100)}`;
  const day = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  const api = () =>
    createDemoApi({
      now: () => NOW,
      material: {
        sources: [
          { id: 'src_001', kind: 'note', title: 'Order notes', url: null, takeaway: `See ${MARKDOWN} for the order.`, text: `First ${SIGNED} then ${WITH_USER} and ${STORAGE}.`, savedAt: day(3), used: false },
          { id: 'src_002', kind: 'note', title: 'A long note', url: null, takeaway: 'Long.', text: longText, savedAt: day(2), used: false },
        ],
        feed: [
          { id: 'feed_001', voice: `Ann (${WITH_USER})`, kind: 'article', title: 'Pots', summary: `Prices in ${SIGNED} and ${MARKDOWN}.`, url: 'https://greenthumb.example/pots', publishedAt: day(1) },
        ],
      },
    });

  it('never leaves in a takeaway, a summary, a voice or a source text', async () => {
    const client = await connectClient(api());
    const answers = [
      await callTool(client, 'list_sources'),
      await callTool(client, 'get_source', { source_id: 'src_001' }),
      await callTool(client, 'get_source', { source_id: 'src_002', part: 1 }),
      await callTool(client, 'get_source', { source_id: 'src_002', part: 2 }),
      await callTool(client, 'list_feed_items', { days: 30 }),
      await callTool(client, 'get_post_suggestions', { count: 6 }),
    ];

    for (const { isError, text } of answers) {
      expect(isError).toBe(false);
      expect(text).not.toMatch(/SECRET/);
    }
    expect(answers[1]?.json.text).toContain(`First ${PLACEHOLDER} then ${PLACEHOLDER} and ${PLACEHOLDER}.`);
    // The whole word that holds the link goes; the full stop after it stays.
    expect(answers[4]?.json.items[0].summary).toBe(`Prices in ${PLACEHOLDER} and [my ${PLACEHOLDER}.`);
    expect(answers[4]?.json.items[0].voice).toBe(`Ann ${PLACEHOLDER}`);
  });

  it('is removed before the cut, so the parts still rebuild the cleaned text', async () => {
    const client = await connectClient(api());
    const inner = (text: string) => text.split('\n').slice(1, -1).join('\n');
    const first = await callTool(client, 'get_source', { source_id: 'src_002', part: 1 });
    const second = await callTool(client, 'get_source', { source_id: 'src_002', part: 2 });

    expect(longText.slice(1970, 2000)).toBe('https://files.example/c.pdf?si');
    expect(first.json.part_count).toBe(2);
    // The whole word that holds the link goes.
    expect(inner(first.json.text) + inner(second.json.text)).toBe(longText.replace(`${'a'.repeat(372)}${ACROSS_THE_CUT}`, PLACEHOLDER));
  });
});

describe('links with any number of slashes', () => {
  // For http, https, ftp, ws, wss and file, the URL parser accepts zero, one
  // or many slashes or backslashes after the colon. So does the check.
  const BACKSLASH = String.fromCodePoint(92);

  it.each([
    ['one slash', 'https:/ann:secret@files.example/p.pdf'],
    ['no slash', 'https:ann:secret@files.example/p.pdf'],
    ['three mixed slashes', `https:/${BACKSLASH}/ann:secret@files.example/p.pdf`],
    ['one backslash and a signed-object path', `https:${BACKSLASH}files.example/object/sign/p.pdf`],
    ['a mixed-case scheme and one slash', 'HtTpS:/ann:secret@files.example/p.pdf'],
    ['one slash and a storage path', 'https:/files.example/storage/v1/object/p.pdf'],
    ['a user name and password with no scheme', 'ann:secret@files.example/p.pdf'],
    ['a key in the fragment, with no scheme', 'app.example/back#access_token=abc'],
    ['a tab inside a query name, with no scheme', `files.example/p.pdf?to${String.fromCodePoint(9)}ken=abc`],
  ])('finds %s, in a title, in a link and inside text', (_name, link) => {
    expect(holdsPrivateLink(link)).toBe(true);
    expect(safeTitle(`Prices ${link}`)).toBe(SAVED_LINK_TITLE);
    expect(safeUrl(link)).toBeNull();
    expect(redactPrivateLinks(`See ${link} today.`)).toBe(`See ${PRIVATE_LINK_REMOVED} today.`);
  });

  it('replaces the whole word that holds the link, but keeps the full stop', () => {
    expect(redactPrivateLinks('Prices:https:/files.example/object/sign/p.pdf.')).toBe(`${PRIVATE_LINK_REMOVED}.`);
  });

  it('leaves a plain email address in text, but replaces a title that holds one', () => {
    const text = 'Write to ann@shop.example for orders.';

    expect(holdsPrivateLink(text)).toBe(false);
    expect(redactPrivateLinks(text)).toBe(text);
    expect(safeTitle('ann@shop.example')).toBe(SAVED_LINK_TITLE);
    expect(safeTitle('ann:secret@files.example')).toBe(SAVED_LINK_TITLE);
    expect(safeTitle('Find us on social: @mossandfern')).toBe('Find us on social: @mossandfern');
  });
});

describe('a private link broken across words', () => {
  const NEWLINE = String.fromCodePoint(10);
  const TAB = String.fromCodePoint(9);

  it.each([
    ['a line break after "?"', `https://files.example/p.pdf?${NEWLINE}token=SECRET6`],
    ['a space after "&"', 'https://files.example/p.pdf?a=1& sig=SECRET7'],
    ['a space after "="', 'https://files.example/p.pdf?token= SECRET8'],
    ['a space after "/"', 'https://ann:SECRET9@files.example/ p.pdf'],
    ['a tab inside the name', `https://files.example/p.pdf?to${TAB}ken=SECRET10`],
    ['a credential with nothing before it', 'token=SECRET11'],
  ])('is removed: %s', (_name, link) => {
    const text = `See ${link} today.`;
    const redacted = redactPrivateLinks(text);

    expect(redacted).not.toMatch(/SECRET/);
    expect(redacted.startsWith('See ')).toBe(true);
    expect(redacted.endsWith(' today.')).toBe(true);
  });
});

describe('a long word', () => {
  it('is checked to its end', () => {
    const word = `${'a'.repeat(5_000)}https://files.example/p.pdf?token=SECRET12`;

    expect(holdsPrivateLink(word)).toBe(true);
    expect(redactPrivateLinks(`See ${word} today.`)).toBe(`See ${PRIVATE_LINK_REMOVED} today.`);
  });
});

describe('hostile text', () => {
  // Each of these is 100,000 characters long. A pattern that backtracks would
  // take seconds or minutes on them.
  const HOSTILE = [
    ['full stops, then a letter', `${'.'.repeat(99_999)}a`],
    ['user:pass shapes', 'a:'.repeat(50_000)],
    ['question marks', '?a'.repeat(50_000)],
    ['schemes', 'https:'.repeat(16_667)],
    ['open markers', '[outside text ends '.repeat(5_264)],
    ['words that run on', 'a/ '.repeat(33_334)],
    ['user names with colons', 'a:a@'.repeat(25_000)],
    ['many short words with an equals sign', '= '.repeat(50_000)],
  ];

  const checkAll = (text: string) => {
    redactPrivateLinks(text);
    sourceParts(text);
    safeTitle(text);
    safeUrl(`https://files.example/${text}`);
  };

  // A pattern that backtracks is slow on every run. A cold start or a busy
  // machine is slow once. So warm up first, and take the fastest of 3 runs.
  // The limit is generous on purpose: a shared CI machine can be slow, and a
  // pattern that backtracks takes several seconds here, not a few milliseconds.
  it.each(HOSTILE)('is checked in under one second: %s', (_name, text) => {
    checkAll(text.slice(0, 1_000));
    const times = [1, 2, 3].map(() => {
      const started = performance.now();
      checkAll(text);
      return performance.now() - started;
    });

    expect(Math.min(...times)).toBeLessThan(1_000);
  });
});

describe('links with other schemes, and secrets past the end of a match', () => {
  it.each([
    ['a user name in an s3 link', 's3://ann@files.example/p.pdf'],
    ['a user name in a webdav link', 'webdav://ann@files.example/p.pdf'],
    ['a signed-object path in an s3 link', 's3://files.example/object/sign/p.pdf'],
  ])('finds %s', (_name, link) => {
    expect(holdsPrivateLink(link)).toBe(true);
    expect(redactPrivateLinks(`See ${link} today.`)).toBe(`See ${PRIVATE_LINK_REMOVED} today.`);
  });

  it('leaves a mailto address alone', () => {
    expect(redactPrivateLinks('Write to mailto:ann@shop.example today.')).toBe('Write to mailto:ann@shop.example today.');
  });

  it('removes the whole word, also the part after a quote that ends the match', () => {
    const redacted = redactPrivateLinks("See https://files.example/p.pdf?token=SEC'XYZ today.");

    expect(redacted).not.toContain('XYZ');
    expect(redacted).toBe(`See ${PRIVATE_LINK_REMOVED} today.`);
  });
});

describe('long names and line breaks', () => {
  const NEWLINE = String.fromCodePoint(10);
  const TAB = String.fromCodePoint(9);

  it.each([
    ['a 300-character user name with no scheme', `${'a'.repeat(300)}:secret@files.example/p.pdf`],
    ['a 300-character password with no scheme', `ann:${'p'.repeat(300)}@files.example/p.pdf`],
    ['a 300-character signed-storage name', `files.example/p.pdf?X-Amz-${'a'.repeat(300)}=1`],
    ['a credential name after a line break', `Notes${NEWLINE}token=SECRET13`],
    ['a link split by a tab', `https://files.example/p.pdf?to${TAB}ken=SECRET14`],
  ])('finds %s', (_name, text) => {
    expect(holdsPrivateLink(text)).toBe(true);
    expect(redactPrivateLinks(`See ${text} today.`)).toBe(`See ${PRIVATE_LINK_REMOVED} today.`);
  });

  it('replaces a title with "@" and a long host name', () => {
    expect(safeTitle(`ann@${'a'.repeat(70)}.example`)).toBe(SAVED_LINK_TITLE);
  });
});

describe('Unicode spaces and the byte order mark', () => {
  const BOM = String.fromCodePoint(0xfeff);
  const NO_BREAK_SPACE = String.fromCodePoint(0xa0);

  it.each([
    ['a byte order mark inside a credential name', `https://files.example/p.pdf?to${BOM}ken=SECRET15`],
    ['a no-break space before a credential name', `Notes${NO_BREAK_SPACE}token=SECRET16`],
  ])('still finds %s', (_name, text) => {
    expect(holdsPrivateLink(text)).toBe(true);
    expect(redactPrivateLinks(`See ${text} today.`)).not.toMatch(/SECRET/);
  });
});
