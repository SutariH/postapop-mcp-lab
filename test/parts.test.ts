import { describe, expect, it } from 'vitest';
import { cleanOutsideText } from '../src/material/outside-text.js';
import { PART_SIZE, sourceParts, splitIntoParts } from '../src/material/parts.js';
import { callTool, connectClient } from './helpers.js';

// One character that NFKC turns into 18 (an Arabic ligature), and one that
// it turns into 3 ("ffi").
const LONG_LIGATURE = String.fromCodePoint(0xfdfa);
const FFI = String.fromCodePoint(0xfb03);
const HERB = String.fromCodePoint(0x1f33f); // an emoji: two UTF-16 units

describe('long text in parts', () => {
  it('cuts at a space near the end of a part, and the parts rebuild the text', () => {
    const text = Array.from({ length: 600 }, (_, index) => `word${index}`).join(' ');
    const parts = splitIntoParts(text, 500);

    expect(parts.join('')).toBe(text);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(500);
    expect(parts[0]?.endsWith(' ')).toBe(true);
  });

  it.each([
    ['U+FDFA, 1 character that becomes 18', LONG_LIGATURE.repeat(500)],
    ['U+FB03, 1 character that becomes 3', FFI.repeat(1500)],
  ])('cleans before it cuts, so no part is over the limit: %s', (_name, text) => {
    const parts = sourceParts(text);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(PART_SIZE);
    expect(parts.join('')).toBe(cleanOutsideText(text));

    // The wrong order, cut first and clean afterwards, breaks the limit.
    const wrongOrder = splitIntoParts(text).map(cleanOutsideText);
    expect(Math.max(...wrongOrder.map((part) => part.length))).toBeGreaterThan(PART_SIZE);
  });

  it('never cuts an emoji in half', () => {
    const text = `${'a'.repeat(PART_SIZE - 1)}${HERB}${'b'.repeat(10)}`;
    const parts = splitIntoParts(text);

    expect(parts.join('')).toBe(text);
    expect(parts[0]?.endsWith('a')).toBe(true);
    expect(parts[1]?.startsWith(HERB)).toBe(true);
  });
});

describe('get_source', () => {
  it('hands out a long text in parts and says what comes next', async () => {
    const client = await connectClient();
    const first = await callTool(client, 'get_source', { source_id: 'src_001' });
    const second = await callTool(client, 'get_source', { source_id: 'src_001', part: 2 });

    expect(first.json).toMatchObject({ part: 1, part_count: 2, next: 'Call get_source with part 2 for the next part.' });
    expect(second.json).toMatchObject({ part: 2, part_count: 2, next: 'This is the last part.' });
    for (const { json } of [first, second]) {
      const inner = json.text.split('\n').slice(1, -1).join('\n');
      expect(inner.length).toBeLessThanOrEqual(PART_SIZE);
    }
  });

  it('answers a part that does not exist with one sentence', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'get_source', { source_id: 'src_001', part: 3 });

    expect(isError).toBe(true);
    expect(text).toBe('Source src_001 has 2 parts. Ask for a part from 1 to 2.');
  });

  it('answers an unknown source with what to do', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'get_source', { source_id: 'src_999' });

    expect(isError).toBe(true);
    expect(text).toBe('There is no saved source with id "src_999". Use list_sources to find the ids.');
  });
});
