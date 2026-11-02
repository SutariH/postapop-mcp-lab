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
  ['add_design_to_post', { post_id: 'post_012', design: 'https://sketchpad.example/design/SPfernCare1/edit' }],
  ['list_sources', {}],
  ['get_source', { source_id: 'src_001', part: 2 }],
  ['list_feed_items', {}],
  ['get_post_suggestions', {}],
];

for (const [name, args] of calls) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  const text = content[0]?.text ?? '';
  console.log(`${name}: ${result.isError ? `error: ${text}` : `ok: ${summarize(text)}`}`);
}

const { prompts } = await client.listPrompts();
console.log(`Prompts: ${prompts.map((prompt) => prompt.name).join(', ')}`);

await client.close();

function summarize(text: string) {
  const data = JSON.parse(text) as {
    posts?: unknown[];
    id?: string;
    status?: string;
    pictures?: unknown[];
    sources?: unknown[];
    part?: number;
    part_count?: number;
    items?: unknown[];
    suggestions?: unknown[];
  };
  if (data.posts) return `${data.posts.length} posts`;
  if (data.pictures) return `${data.pictures.length} pictures`;
  if (data.sources) return `${data.sources.length} sources`;
  if (data.part) return `part ${data.part} of ${data.part_count}`;
  if (data.items) return `${data.items.length} feed items`;
  if (data.suggestions) return `${data.suggestions.length} suggestions`;
  return `${data.status} ${data.id}`;
}
