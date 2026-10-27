import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SchedulingApi } from '../scheduling-api.js';
import { jsonResult, shorten, toErrorResult } from './results.js';

const HOW_TO_READ =
  'null means the network has not reported this number. It is not zero. Each network counts differently, so compare posts within one network and never add numbers across networks.';

export function registerGetPostResults(server: McpServer, api: SchedulingApi) {
  server.registerTool(
    'get_post_results',
    {
      title: 'Get post results',
      description: [
        'Returns the numbers (impressions, likes, comments, shares) for posts published in the last 7, 30 or 90 days, one row per post and channel, newest post first.',
        'Use it when the user asks how posts performed or which post did best.',
        'A null number means the network has not reported it yet, or does not report it at all. Never treat null as zero: say the number is not reported.',
        'Networks count in different ways, so never add numbers across networks. Compare posts within one network.',
        'This tool only reads.',
      ].join(' '),
      inputSchema: {
        days: z
          .literal([7, 30, 90], { error: 'days must be 7, 30 or 90.' })
          .default(30)
          .describe('How many days to look back: 7, 30 or 90.'),
      },
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ days }) => {
      try {
        const [workspace, report] = await Promise.all([
          api.getWorkspace(),
          api.getResults({ days }),
        ]);

        return jsonResult({
          workspace: workspace.name,
          period: { days, from: report.from, to: report.to },
          how_to_read: HOW_TO_READ,
          posts: report.posts.map(({ post, results }) => ({
            id: post.id,
            published_at: post.time,
            text: shorten(post.text, 80),
            results: results.map((result) => ({
              channel_id: result.channelId,
              network:
                workspace.channels.find((channel) => channel.id === result.channelId)?.network ??
                'unknown',
              impressions: result.impressions,
              likes: result.likes,
              comments: result.comments,
              shares: result.shares,
            })),
          })),
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
