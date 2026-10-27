import { describe, expect, it } from 'vitest';
import { callTool, connectClient } from './helpers.js';

describe('get_post_results', () => {
  it('is listed as a read-only tool that warns about null and about adding networks', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'get_post_results');

    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tool?.description).toContain('Never treat null as zero');
    expect(tool?.description).toContain('never add numbers across networks');
  });

  it('returns the last 7 days, newest post first', async () => {
    const client = await connectClient();
    const { isError, json } = await callTool(client, 'get_post_results', { days: 7 });

    expect(isError).toBe(false);
    expect(json.period).toEqual({
      days: 7,
      from: '2026-10-26T12:00:00.000Z',
      to: '2026-11-02T12:00:00.000Z',
    });
    expect(json.posts.map((post: { id: string }) => post.id)).toEqual([
      'post_006',
      'post_005',
      'post_004',
    ]);
  });

  it('keeps unreported numbers as null, never as zero', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'get_post_results', { days: 7 });

    expect(json.posts[0].results).toEqual([
      {
        channel_id: 'ch_bluesky',
        network: 'Bluesky',
        impressions: null,
        likes: 21,
        comments: 3,
        shares: null,
      },
    ]);
    expect(json.how_to_read).toContain('It is not zero.');
  });

  it('gives one row per channel for a post on two networks', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'get_post_results', { days: 30 });
    const post = json.posts.find((candidate: { id: string }) => candidate.id === 'post_003');

    expect(post.results.map((row: { network: string }) => row.network)).toEqual([
      'Instagram',
      'Bluesky',
    ]);
  });

  it('looks back 30 days by default', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'get_post_results');

    expect(json.period.days).toBe(30);
    expect(json.posts.map((post: { id: string }) => post.id)).toEqual([
      'post_006',
      'post_005',
      'post_004',
      'post_003',
      'post_002',
    ]);
  });

  it('includes older posts in the 90-day view', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'get_post_results', { days: 90 });

    expect(json.posts.at(-1).id).toBe('post_001');
  });

  it('refuses a period that is not 7, 30 or 90 days', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'get_post_results', { days: 14 });

    expect(isError).toBe(true);
    expect(text).toContain('days must be 7, 30 or 90.');
  });
});
