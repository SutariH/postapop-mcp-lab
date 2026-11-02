// Long text in parts. A saved article can be longer than a model wants in one
// tool answer, so get_source hands it out part by part.
//
// The order matters: clean (NFKC) FIRST, then cut. NFKC can turn one
// character into many (U+FDFA becomes 18 characters), so a part cut first
// and cleaned later could be far larger than promised.

import { cleanOutsideText } from './outside-text.js';
import { redactPrivateLinks } from './private-links.js';

/** The most characters in one part, before the two fence markers. */
export const PART_SIZE = 2000;

function isLowSurrogate(code: number) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * Cuts text into parts of at most `size` characters. Each cut falls at a line
 * break or a space in the last fifth of the part when there is one, and never
 * between the two halves of one character (an emoji, for example). The parts
 * joined give the text back exactly.
 */
export function splitIntoParts(text: string, size = PART_SIZE) {
  const parts: string[] = [];
  let rest = text;

  while (rest.length > size) {
    const window = rest.slice(0, size);
    const floor = Math.floor(size * 0.8);
    const lineBreak = window.lastIndexOf('\n');
    const space = window.lastIndexOf(' ');
    let cut = lineBreak >= floor ? lineBreak + 1 : space >= floor ? space + 1 : size;
    if (isLowSurrogate(rest.charCodeAt(cut))) cut -= 1;

    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  parts.push(rest);

  return parts;
}

/**
 * A stored text, cleaned once, with its private links removed, and then cut.
 * Fence each part without cleaning it again.
 */
export function sourceParts(text: string, size = PART_SIZE) {
  return splitIntoParts(redactPrivateLinks(cleanOutsideText(text)), size);
}
