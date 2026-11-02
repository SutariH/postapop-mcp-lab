import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// A ready-made prompt. A client can show it in a menu, so the person picks
// "What should I post this week?" instead of typing the right words. The
// text tells the model which tools to use, in which order, and to ask
// before it saves anything.
export const WHAT_TO_POST_PROMPT = {
  name: 'what_to_post_this_week',
  title: 'What should I post this week?',
  text: [
    'What should I post this week?',
    'Use the postapop-demo tools: get ideas with get_post_suggestions. When an idea comes from a saved source, read it with get_source; for a link, follow its how_to_read.',
    'Give me the ideas best first, each with its why_now line and its links.',
    'Then ask which one I want as a draft. Do not save anything before I choose.',
  ].join(' '),
};

export function registerWhatToPostPrompt(server: McpServer) {
  server.registerPrompt(
    WHAT_TO_POST_PROMPT.name,
    {
      title: WHAT_TO_POST_PROMPT.title,
      description: 'Post ideas for this week from the shop\'s voices, saved sources and ideas list, with why now and links.',
    },
    () => ({
      messages: [{ role: 'user', content: { type: 'text', text: WHAT_TO_POST_PROMPT.text } }],
    }),
  );
}
