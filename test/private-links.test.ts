import { describe, expect, it } from 'vitest';
import { holdsPrivateLink, safeTitle, safeUrl, SAVED_LINK_TITLE } from '../src/material/private-links.js';
import { callTool, connectClient } from './helpers.js';

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
