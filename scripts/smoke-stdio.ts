// Starts the stdio server as a child process, the way Claude Desktop does,
// and calls each tool once. Run it with `npm run smoke`, or with
// `npm run smoke -- --built` to test the compiled server in dist/.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const useBuild = process.argv.includes('--built');
const transport = new StdioClientTransport({
  command: process.execPath,
  args: useBuild ? ['dist/stdio.js'] : ['--import', 'tsx', 'src/stdio.ts'],
  cwd: process.cwd(),
  stderr: 'inherit',
});

const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`Tools: ${tools.map((tool) => tool.name).join(', ')}`);

const calls: Array<[string, Record<string, unknown>]> = [
  ['list_scheduled_posts', {}],
  ['create_draft_post', { text: 'Smoke test draft.', channel_ids: ['ch_linkedin'] }],
  ['create_draft_post', { text: 'x'.repeat(320), channel_ids: ['ch_bluesky'] }],
  ['get_post_results', { days: 7 }],
];

for (const [name, args] of calls) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content[0]?.text ?? '';
  console.log(`${name}: ${result.isError ? `error: ${text}` : `ok: ${summarize(text)}`}`);
}

await client.close();

function summarize(text: string) {
  const data = JSON.parse(text) as { posts?: unknown[]; id?: string; status?: string };
  if (data.posts) return `${data.posts.length} posts`;
  return `${data.status} ${data.id}`;
}
