import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SchedulingApi } from '../scheduling-api.js';
import { jsonResult, toErrorResult } from './results.js';

export function registerCreateDraftPost(server: McpServer, api: SchedulingApi) {
  server.registerTool(
    'create_draft_post',
    {
      title: 'Create a draft post',
      description: [
        "Saves a new draft post in the workspace's calendar.",
        'Use it when the user asks you to write, draft or prepare a post and wants to keep it.',
        'This tool only saves a draft. It never schedules or publishes anything, and nobody outside the workspace sees the draft.',
        'Each call creates a new draft, so call it once per post. If the user wants changes, show the new text first and save it only when they agree.',
        'channel_ids are optional. Get them from the channels list in a list_scheduled_posts result.',
        'Bluesky allows at most 300 characters. If the text is too long for a channel, the tool refuses the draft and says how many characters to cut.',
      ].join(' '),
      inputSchema: {
        text: z
          .string()
          .trim()
          .min(1, 'text is empty. Write the post text, then call the tool again.')
          .max(2000, 'text is longer than 2,000 characters. Shorten it, then call the tool again.')
          .describe('The full post text, 1 to 2,000 characters.'),
        channel_ids: z
          .array(z.string().min(1))
          .max(10)
          .default([])
          .describe(
            'The channels the post is meant for, for example ["ch_linkedin"]. Leave it out to save a draft with no channel yet.',
          ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ text, channel_ids }) => {
      try {
        const [workspace, draft] = await Promise.all([
          api.getWorkspace(),
          api.createDraft({ text, channelIds: channel_ids }),
        ]);

        return jsonResult({
          id: draft.id,
          status: draft.status,
          text: draft.text,
          channels: draft.channelIds.map((id) => ({
            id,
            network: workspace.channels.find((channel) => channel.id === id)?.network ?? 'unknown',
          })),
          note: 'Saved as a draft. It is not scheduled and will not be published. The user can review and schedule it in the app.',
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
