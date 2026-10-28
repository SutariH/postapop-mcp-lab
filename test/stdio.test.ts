// Starts the real stdio entry point in a child process. If anything writes
// to stdout that is not a protocol message, the client fails to connect.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect, it } from 'vitest';

it('works over stdio as a child process', { timeout: 20_000 }, async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/stdio.ts'],
    cwd: process.cwd(),
    stderr: 'pipe',
  });
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });

  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    const result = await client.callTool({ name: 'list_scheduled_posts', arguments: {} });

    expect(tools).toHaveLength(4);
    expect(result.isError).not.toBe(true);
  } finally {
    await client.close();
  }
});
