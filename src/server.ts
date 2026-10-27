import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SchedulingApi } from './scheduling-api.js';
import { registerCreateDraftPost } from './tools/create-draft-post.js';
import { registerListScheduledPosts } from './tools/list-scheduled-posts.js';

export const SERVER_INFO = { name: 'postapop-demo', version: '0.1.0' };

export function createServer(api: SchedulingApi) {
  const server = new McpServer(SERVER_INFO);

  registerListScheduledPosts(server, api);
  registerCreateDraftPost(server, api);

  return server;
}
