// Links and directions instead of your own AI. The server does not read,
// summarize or rewrite anything with a model. It hands the client's model the
// link and one plain direction for that kind of material. The person's own
// AI tool does the reading, on the person's account.

import type { SourceKind } from '../scheduling-api.js';

export const HOW_TO_READ = {
  article:
    'Open the link with your web tool. If it is behind a paywall or you cannot open it, use the summary, and tell the person that you could not read the full article.',
  video:
    'Try to open the link. If you cannot get the words of the video, ask the person to open the video page, show its transcript, and paste the text here.',
  podcast:
    'Open the episode page and read the show notes. You cannot hear the audio. Ask the person for the points they liked, or for a transcript if the show has one.',
  saved:
    'The text is stored. Read it with get_source, part by part. There is no need to open the link.',
  idea: "This is an idea from the shop's own list. Ask the person what they want to say about it before you write.",
} as const;

/** The direction for a feed item, by its kind. */
export function howToReadLink(kind: SourceKind) {
  if (kind === 'video') return HOW_TO_READ.video;
  if (kind === 'podcast') return HOW_TO_READ.podcast;
  return HOW_TO_READ.article;
}
