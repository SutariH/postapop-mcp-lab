import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Post, SchedulingApi, Workspace } from '../scheduling-api.js';
import { jsonResult, shorten, toErrorResult } from './results.js';

const isoTime = z.iso.datetime({
  offset: true,
  error: 'Use an ISO 8601 time with a time zone offset, for example 2026-11-02T09:00:00-05:00.',
});

export function registerListScheduledPosts(server: McpServer, api: SchedulingApi) {
  server.registerTool(
    'list_scheduled_posts',
    {
      title: 'List scheduled posts',
      description: [
        "Lists posts in the workspace's social media calendar.",
        'Use it to answer questions such as "What is scheduled next week?" or "What did we publish this month?", and to look up channel ids before you call create_draft_post.',
        'status "upcoming" (the default) returns scheduled posts, "published" returns posts that went out, and "drafts" returns drafts that have no time yet.',
        'Without from and to, upcoming covers the next 14 days and published covers the last 14 days. A window can be at most 31 days long. Drafts ignore from and to.',
        'Times in the result are UTC. Convert them to the workspace time zone, which the result also gives, when you talk to the user.',
        'This tool only reads. It never changes, schedules or publishes a post.',
      ].join(' '),
      inputSchema: {
        status: z
          .enum(['upcoming', 'drafts', 'published'])
          .default('upcoming')
          .describe('Which posts to list.'),
        from: isoTime
          .optional()
          .describe('Start of the time window, ISO 8601 with an offset, for example 2026-11-02T00:00:00-05:00.'),
        to: isoTime
          .optional()
          .describe('End of the time window (not included), ISO 8601 with an offset.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ status, from, to }) => {
      try {
        const [workspace, list] = await Promise.all([
          api.getWorkspace(),
          api.listPosts({ status, from, to }),
        ]);

        return jsonResult({
          workspace: workspace.name,
          time_zone: workspace.timeZone,
          status,
          window: list.window,
          channels: workspace.channels,
          posts: list.posts.map((post) => formatPost(post, workspace)),
          ...(list.posts.length === 0 && { note: `There are no ${status} posts in this window.` }),
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}

function formatPost(post: Post, workspace: Workspace) {
  return {
    id: post.id,
    status: post.status,
    time: post.time,
    text: shorten(post.text),
    channels: post.channelIds.map((id) => {
      const channel = workspace.channels.find((candidate) => candidate.id === id);
      return { id, network: channel?.network ?? 'unknown' };
    }),
  };
}
