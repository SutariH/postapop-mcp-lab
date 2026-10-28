import { describe, expect, it } from 'vitest';
import { callTool, connectClient } from './helpers.js';

describe('list_scheduled_posts', () => {
  it('is listed as a read-only tool', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'list_scheduled_posts');

    expect(tool?.annotations).toMatchObject({ readOnlyHint: true, openWorldHint: false });
    expect(tool?.description).toContain('never changes, schedules or publishes');
  });

  it('lists upcoming posts for the next 14 days by default', async () => {
    const client = await connectClient();
    const { isError, json } = await callTool(client, 'list_scheduled_posts');

    expect(isError).toBe(false);
    expect(json.window).toEqual({
      from: '2026-11-02T12:00:00.000Z',
      to: '2026-11-16T12:00:00.000Z',
    });
    expect(json.posts.map((post: { id: string }) => post.id)).toEqual([
      'post_007',
      'post_008',
      'post_009',
      'post_010',
    ]);
    expect(json.posts[0]).toMatchObject({
      status: 'scheduled',
      time: '2026-11-03T14:00:00.000Z',
      channels: [
        { id: 'ch_instagram', network: 'Instagram' },
        { id: 'ch_linkedin', network: 'LinkedIn' },
      ],
    });
  });

  it('gives the model the workspace time zone and the channel ids', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'list_scheduled_posts');

    expect(json.time_zone).toBe('America/New_York');
    expect(json.channels.map((channel: { id: string }) => channel.id)).toEqual([
      'ch_instagram',
      'ch_linkedin',
      'ch_bluesky',
    ]);
  });

  it('lists published posts from the last 14 days', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'list_scheduled_posts', { status: 'published' });

    expect(json.posts.map((post: { id: string }) => post.id)).toEqual([
      'post_003',
      'post_004',
      'post_005',
      'post_006',
    ]);
  });

  it('lists drafts without a time window', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'list_scheduled_posts', { status: 'drafts' });

    expect(json.window).toBeNull();
    expect(json.posts.map((post: { id: string }) => post.id)).toEqual(['post_012', 'post_013']);
  });

  it('accepts a window with a time zone offset', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'list_scheduled_posts', {
      from: '2026-11-12T00:00:00-05:00',
      to: '2026-11-30T00:00:00-05:00',
    });

    expect(json.posts.map((post: { id: string }) => post.id)).toEqual(['post_010', 'post_011']);
  });

  it('accepts a time without seconds, as models often send it', async () => {
    const client = await connectClient();
    const { isError, json } = await callTool(client, 'list_scheduled_posts', {
      from: '2026-11-12T00:00-05:00',
      to: '2026-11-30T00:00-05:00',
    });

    expect(isError).toBe(false);
    expect(json.posts.map((post: { id: string }) => post.id)).toEqual(['post_010', 'post_011']);
  });

  it('says so in a sentence when a window has no posts', async () => {
    const client = await connectClient();
    const { json } = await callTool(client, 'list_scheduled_posts', {
      from: '2027-03-01T00:00:00Z',
      to: '2027-03-08T00:00:00Z',
    });

    expect(json.posts).toEqual([]);
    expect(json.note).toBe('There are no upcoming posts in this window.');
  });

  it('refuses a window longer than 31 days with a sentence that names the fix', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'list_scheduled_posts', {
      from: '2026-11-01T00:00:00Z',
      to: '2026-12-15T00:00:00Z',
    });

    expect(isError).toBe(true);
    expect(text).toBe(
      'The window is 44 days long, but the longest allowed window is 31 days. Ask for a shorter window, or make one call per month.',
    );
  });

  it('refuses a window that ends before it starts', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'list_scheduled_posts', {
      from: '2026-11-10T00:00:00Z',
      to: '2026-11-05T00:00:00Z',
    });

    expect(isError).toBe(true);
    expect(text).toContain('must be earlier than the end');
  });

  it('rejects a time without an offset and explains the format', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'list_scheduled_posts', {
      from: 'next Monday',
    });

    expect(isError).toBe(true);
    expect(text).toContain('Use an ISO 8601 time with a time zone offset');
  });
});
