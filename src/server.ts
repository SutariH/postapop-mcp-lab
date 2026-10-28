import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SchedulingApi } from './scheduling-api.js';
import { registerAddDesignToPost } from './tools/add-design-to-post.js';
import { registerAddPicturesToPost } from './tools/add-pictures-to-post.js';
import { registerCreateDraftPost } from './tools/create-draft-post.js';
import { registerGetPostResults } from './tools/get-post-results.js';
import { registerListScheduledPosts } from './tools/list-scheduled-posts.js';

export const SERVER_INFO = { name: 'postapop-demo', version: '0.1.0' };

// Clients can show these instructions to the model once, next to the tool list.
const INSTRUCTIONS = [
  'This server connects to a demo workspace for Moss & Fern, a small plant shop, in a social media scheduling app. All data is mock data.',
  'Read before you write: call list_scheduled_posts to see the calendar and the channel ids before you create a draft.',
  'To put a Sketchpad design on a draft, pass its id or link to add_design_to_post. Never try to send a file.',
  'These tools never schedule or publish a post. The user does that in the app.',
].join(' ');

interface ServerOptions {
  /**
   * True when the client can hand files to a tool. Only then is
   * add_pictures_to_post listed. This is for the person's sake (no tool
   * that cannot work for them); the real guard is the download check.
   */
  files?: boolean;
}

export function createServer(api: SchedulingApi, { files = false }: ServerOptions = {}) {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  registerListScheduledPosts(server, api);
  registerCreateDraftPost(server, api);
  registerGetPostResults(server, api);
  registerAddDesignToPost(server, api);
  if (files) {
    registerAddPicturesToPost(server, api);
  }

  return server;
}
