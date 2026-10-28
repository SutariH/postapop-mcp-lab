import { describe, expect, it } from 'vitest';
import { callTool, connectClient, createTestApi } from './helpers.js';

describe('add_design_to_post', () => {
  it('is a write tool that is safe to repeat, can replace pictures, and talks to another service', async () => {
    const client = await connectClient();
    const { tools } = await client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'add_design_to_post');

    expect(tool?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true });
    expect(tool?.description).toContain('never a file');
  });

  it('adds the pictures of a design to a draft', async () => {
    const client = await connectClient();
    const { isError, json } = await callTool(client, 'add_design_to_post', {
      post_id: 'post_012',
      design: 'https://sketchpad.example/design/SPfernCare1/edit',
    });

    expect(isError).toBe(false);
    expect(json.design).toEqual({ id: 'SPfernCare1', title: 'Fern care in 3 slides' });
    expect(json.pictures.map((picture: { page: number }) => picture.page)).toEqual([1, 2, 3]);
    expect(json.post_url).toBe('https://app.example.com/posts/post_012');
  });

  it('answers a bad reference with one sentence that says what to send', async () => {
    const client = await connectClient();
    const { isError, text } = await callTool(client, 'add_design_to_post', {
      post_id: 'post_012',
      design: 'https://files.example/poster.png',
    });

    expect(isError).toBe(true);
    expect(text).toBe(
      'That is not a Sketchpad design. Send the design id, such as SPfernCare1, or a link that starts with https://sketchpad.example/design/.',
    );
  });

  it('records every call, refused or not', async () => {
    const api = createTestApi();
    const client = await connectClient(api);
    await callTool(client, 'add_design_to_post', { post_id: 'post_012', design: 'SPfernCare1' });
    await callTool(client, 'add_design_to_post', { post_id: 'post_012', design: 'SPrepotReel' });

    expect((await api.getActivity()).map((event) => event.outcome)).toEqual(['ok', 'refused']);
  });
});
