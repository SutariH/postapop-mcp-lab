import { expect, it } from 'vitest';
import { connectClient } from './helpers.js';

it('introduces itself with a name and a version', async () => {
  const client = await connectClient();

  expect(client.getServerVersion()).toMatchObject({
    name: 'postapop-demo',
    version: '0.1.0',
  });
});
