import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SchedulingApi } from '../scheduling-api.js';
import { jsonResult, toErrorResult } from './results.js';

export function registerAddDesignToPost(server: McpServer, api: SchedulingApi) {
  server.registerTool(
    'add_design_to_post',
    {
      title: 'Add a Sketchpad design to a draft',
      description: [
        'Puts the pages of a Sketchpad design on a draft post, as pictures.',
        'Use it when the user wants a design they made or found in Sketchpad on one of their drafts.',
        'Send a reference, never a file: the design id (such as SPfernCare1) or its https://sketchpad.example/design/ link. The server gets the pictures from Sketchpad through its own connection.',
        'Drafts only. A post holds at most 10 pictures; extra pages are left out, and the result names them.',
        'Adding the same design again replaces its pictures in place. If the design has not changed, nothing is exported again, so calling twice is safe.',
        'If the result is an error, it says what to do. When it gives a link, pass the link to the user.',
      ].join(' '),
      inputSchema: {
        post_id: z.string().min(1).max(40).describe('The draft to add the pictures to, for example "post_012".'),
        design: z
          .string()
          .trim()
          .min(1, 'design is empty. Send the Sketchpad design id or its link.')
          .max(500, 'design is longer than 500 characters. Send only the design id or its link.')
          .describe('The Sketchpad design id, or a https://sketchpad.example/design/<id> link.'),
      },
      annotations: {
        readOnlyHint: false,
        // Adding the design again removes its old pictures from the post (they stay
        // in the media library). Nothing else on the post is touched.
        destructiveHint: true,
        // The same design twice leaves the post the same as once.
        idempotentHint: true,
        // It reads from another service, Sketchpad.
        openWorldHint: true,
      },
    },
    async ({ post_id, design }) => {
      try {
        const attachment = await api.addDesignToDraft({ postId: post_id, design });
        const count = attachment.pictures.length;
        const notes = [
          attachment.unchanged
            ? 'The design has not changed since it was added, so nothing was exported. The post already has these pictures.'
            : `The post now has ${count} ${count === 1 ? 'picture' : 'pictures'} from this design. It is still a draft.`,
        ];
        if (attachment.pagesLeftOut.length > 0) {
          notes.push(`Pages ${attachment.pagesLeftOut.join(', ')} did not fit, because a post holds at most 10 pictures. They are not on the post.`);
        }

        return jsonResult({
          post_id: attachment.postId,
          post_url: attachment.postUrl,
          design: { id: attachment.designId, title: attachment.title },
          pictures: attachment.pictures.map((picture) => ({ page: picture.page, media_id: picture.mediaId })),
          unchanged: attachment.unchanged,
          pages_left_out: attachment.pagesLeftOut,
          note: notes.join(' '),
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
