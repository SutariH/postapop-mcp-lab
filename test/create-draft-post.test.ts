import { describe, expect, it } from 'vitest';
import { callTool, connectClient } from './helpers.js';

describe('create_draft_post', () => {
  it('is listed as a write tool that is not destructive and not idempotent', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'create_draft_post');

    expect(tool?.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(tool?.description).toContain('never schedules or publishes');
  });

  it('saves a draft for a channel and says it is not scheduled', async () => {
    const client = await connectClient();
    const { isError, json } = await callTool(client, 'create_draft_post', {
      text: 'Join our autumn repotting workshop.',
      channel_ids: ['ch_linkedin'],
    });

    expect(isError).toBe(false);
    expect(json).toMatchObject({
      id: 'post_101',
      status: 'draft',
      text: 'Join our autumn repotting workshop.',
      channels: [{ id: 'ch_linkedin', network: 'LinkedIn' }],
    });
    expect(json.note).toContain('It is not scheduled and will not be published.');
  });

  it('shows the new draft in the drafts list', async () => {
    const client = await connectClient();
    await callTool(client, 'create_draft_post', { text: 'A draft with no channel yet.' });
    const { json } = await callTool(client, 'list_scheduled_posts', { status: 'drafts' });

    expect(json.posts.map((post: { id: string }) => post.id)).toEqual([
      'post_012',
      'post_013',
      'post_101',
    ]);
  });

  it('creates a new draft on every call', async () => {
    const client = await connectClient();
    const first = await callTool(client, 'create_draft_post', { text: 'Same text.' });
    const second = await callTool(client, 'create_draft_post', { text: 'Same text.' });

    expect([first.json.id, second.json.id]).toEqual(['post_101', 'post_102']);
  });

  it('names the valid channel ids when a channel id is wrong', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'create_draft_post', {
      text: 'Hello',
      channel_ids: ['ch_twitter'],
    });

    expect(isError).toBe(true);
    expect(text).toBe(
      'There is no channel with id "ch_twitter". The channel ids in this workspace are ch_instagram (Instagram), ch_linkedin (LinkedIn), and ch_bluesky (Bluesky).',
    );
  });

  it('refuses a Bluesky draft over 300 characters and says how much to cut', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'create_draft_post', {
      text: 'a'.repeat(412),
      channel_ids: ['ch_instagram', 'ch_bluesky'],
    });

    expect(isError).toBe(true);
    expect(text).toBe(
      'This draft is 412 characters long, but Bluesky allows 300. Cut at least 112 characters, or leave the Bluesky channel (ch_bluesky) out of this draft.',
    );
  });

  it('accepts the same long text for Instagram alone', async () => {
    const client = await connectClient();
    const { isError } = await callTool(client, 'create_draft_post', {
      text: 'a'.repeat(412),
      channel_ids: ['ch_instagram'],
    });

    expect(isError).toBe(false);
  });

  it('counts characters as people see them', async () => {
    const client = await connectClient();
    // 300 x "e" plus a combining accent: 600 UTF-16 code units, 300 visible characters.
    const { isError } = await callTool(client, 'create_draft_post', {
      text: 'é'.repeat(300),
      channel_ids: ['ch_bluesky'],
    });

    expect(isError).toBe(false);
  });

  it('refuses empty text', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'create_draft_post', { text: '   ' });

    expect(isError).toBe(true);
    expect(text).toContain('text is empty');
  });

  it('refuses text over 2,000 characters', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'create_draft_post', {
      text: 'a'.repeat(2001),
    });

    expect(isError).toBe(true);
    expect(text).toContain('text is longer than 2,000 characters');
  });
});
