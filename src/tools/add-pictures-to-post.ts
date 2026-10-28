import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { SchedulingApi } from '../scheduling-api.js';
import { jsonResult, toErrorResult } from './results.js';

/**
 * The shape a chat client uses for a file it hands to a tool. Declare all
 * four fields, but require only the two that are always there.
 */
const fileParam = z.object({
  download_url: z.string().max(4000).describe('A short-lived link to the file. It works for a few minutes only.'),
  file_id: z.string().min(1).max(200).describe('The chat client\'s id for the file.'),
  mime_type: z.string().max(100).optional().describe('The type the client says the file has, such as image/png.'),
  file_name: z.string().max(300).optional().describe('The file name, if the person uploaded the file.'),
});

export function registerAddPicturesToPost(server: McpServer, api: SchedulingApi) {
  server.registerTool(
    'add_pictures_to_post',
    {
      title: 'Add pictures from the chat to a draft',
      description: [
        'Puts pictures from this chat on a draft post: pictures you made in the chat, or pictures the user attached.',
        'Use it when the user wants a picture from the chat on one of their drafts.',
        'Pass each picture as a file from the chat, in the order the post should show them. Never pass a link from the web.',
        'Drafts only, and a post holds at most 10 pictures. PNG, JPEG or WebP, up to 20 MB each.',
        'All or nothing: if one picture is refused, none is added, and the answer says which one and why.',
        'A picture that is already on the draft is not added again, so a repeat is safe.',
      ].join(' '),
      inputSchema: {
        post_id: z.string().min(1).max(40).describe('The draft to add the pictures to, for example "post_012".'),
        pictures: z.array(fileParam).min(1).max(10).describe('The pictures, in the order the post should show them.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false, // it only adds; nothing on the post is removed or replaced
        idempotentHint: true, // the same pictures again change nothing
        openWorldHint: true, // it downloads from the chat client's file store
      },
      // Tells the chat client which inputs are files, so it sends a file
      // object instead of text. Without this, the client cannot pass a file.
      _meta: { 'openai/fileParams': ['pictures'] },
    },
    async ({ post_id, pictures }) => {
      try {
        const result = await api.addPicturesToDraft({
          postId: post_id,
          files: pictures.map((picture) => ({
            downloadUrl: picture.download_url,
            fileId: picture.file_id,
            mimeType: picture.mime_type,
            fileName: picture.file_name,
          })),
        });
        const notes = [`The post now has ${result.pictureCount} ${result.pictureCount === 1 ? 'picture' : 'pictures'}. It is still a draft.`];
        if (result.alreadyOnPost > 0) {
          notes.push(`${result.alreadyOnPost} of the pictures ${result.alreadyOnPost === 1 ? 'was' : 'were'} already on the post, so ${result.alreadyOnPost === 1 ? 'it was' : 'they were'} not added again.`);
        }
        return jsonResult({
          post_id: result.postId,
          post_url: result.postUrl,
          added: result.added.map((picture) => ({ media_id: picture.mediaId, file_name: picture.fileName })),
          already_on_post: result.alreadyOnPost,
          picture_count: result.pictureCount,
          note: notes.join(' '),
        });
      } catch (error) {
        return toErrorResult(error);
      }
    },
  );
}
