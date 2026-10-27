import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SchedulingApi } from './scheduling-api.js';
import { registerCreateDraftPost } from './tools/create-draft-post.js';
import { registerGetPostResults } from './tools/get-post-results.js';
import { registerListScheduledPosts } from './tools/list-scheduled-posts.js';

export const SERVER_INFO = { name: 'postapop-demo', version: '0.1.0' };

// Clients can show these instructions to the model once, next to the tool list.
const INSTRUCTIONS = [
  'This server connects to a demo workspace for Moss & Fern, a small plant shop, in a social media scheduling app. All data is mock data.',
  'Read before you write: call list_scheduled_posts to see the calendar and the channel ids before you create a draft.',
  'These tools never schedule or publish a post. The user does that in the app.',
].join(' ');

export function createServer(api: SchedulingApi) {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  registerListScheduledPosts(server, api);
  registerCreateDraftPost(server, api);
  registerGetPostResults(server, api);

  return server;
}
