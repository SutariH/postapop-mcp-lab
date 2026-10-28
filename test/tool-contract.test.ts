// Checks the parts of every tool that the model and the client read.
// If you add a tool and forget its annotations or description, this test fails.

import { expect, it } from 'vitest';
import { connectClient } from './helpers.js';

it('offers exactly the four lab tools', async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();

  expect(tools.map((tool) => tool.name).sort()).toEqual([
    'add_design_to_post',
    'create_draft_post',
    'get_post_results',
    'list_scheduled_posts',
  ]);
});

it('gives every tool a title, a full description and explicit annotations', async () => {
  const client = await connectClient();
  const { tools } = await client.listTools();

  for (const tool of tools) {
    expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)+$/);
    expect(tool.title).toBeTruthy();
    expect(tool.description?.length).toBeGreaterThan(150);
    expect(tool.description).toMatch(/Use it when|Use it to/);
    expect(typeof tool.annotations?.readOnlyHint).toBe('boolean');
    expect(typeof tool.annotations?.openWorldHint).toBe('boolean');
  }
});

it('sends server instructions that say the tools never publish', async () => {
  const client = await connectClient();

  expect(client.getInstructions()).toContain('never schedule or publish');
});
