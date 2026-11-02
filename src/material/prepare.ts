// The one way outside text is made ready for a model. Every summary,
// takeaway, voice and saved text goes through it, before any cut.

import { cleanOutsideText } from './outside-text.js';
import { redactPrivateLinks } from './private-links.js';

/**
 * Cleans the text, removes private links, then cleans again, until nothing
 * changes. The first cleaning lets the link check see through look-alike and
 * invisible characters. The second one makes sure that the removal cannot
 * leave something shaped like a fence marker behind.
 */
export function prepareOutsideText(text: string) {
  let ready = cleanOutsideText(text);

  for (let round = 0; round < 3; round += 1) {
    const next = cleanOutsideText(redactPrivateLinks(ready));
    if (next === ready) break;
    ready = next;
  }

  return ready;
}
