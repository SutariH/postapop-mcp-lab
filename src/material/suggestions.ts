// Post suggestions from what the shop already keeps. No model, no chance:
// the same data and the same clock always give the same answer, so a
// suggestion can be tested, explained and trusted.
//
// The mix rule: take turns between the places (voices, then saved sources,
// then the ideas list), at most MAX_PER_PLACE from one place. Without it, a
// busy feed would fill the whole list and the shop's own ideas would never
// come up.

import type { FeedItem, SourceView, Suggestion, SuggestionPlace } from '../scheduling-api.js';
import { HOW_TO_READ } from './how-to-read.js';

export const MAX_PER_PLACE = 2;
const PLACES: SuggestionPlace[] = ['voices', 'sources', 'ideas'];
export const MAX_SUGGESTIONS = MAX_PER_PLACE * PLACES.length;

/** Feed items count as news for this many days. */
const FRESH_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IdeaRecord {
  id: string;
  text: string;
  addedAt: string;
  status: 'open' | 'used';
}

interface SuggestionInput {
  /** Feed items, already through the private-link rule. */
  feed: FeedItem[];
  /** Saved sources, already through the private-link rule. */
  sources: SourceView[];
  ideas: IdeaRecord[];
  now: Date;
  count: number;
}

function daysAgo(now: Date, time: string) {
  const days = Math.floor((now.getTime() - Date.parse(time)) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

/** Newest first; the id breaks a tie, so the order never depends on chance. */
const newestFirst = (a: { time: string; id: string }, b: { time: string; id: string }) =>
  b.time.localeCompare(a.time) || a.id.localeCompare(b.id);
const oldestFirst = (a: { time: string; id: string }, b: { time: string; id: string }) =>
  a.time.localeCompare(b.time) || a.id.localeCompare(b.id);

export function suggestPosts({ feed, sources, ideas, now, count }: SuggestionInput): Suggestion[] {
  const freshFrom = now.getTime() - FRESH_DAYS * DAY_MS;

  // Voices: what people the shop follows posted this week, newest first.
  const voices: Suggestion[] = feed
    .filter((item) => Date.parse(item.publishedAt) >= freshFrom)
    .map((item) => ({ item, time: item.publishedAt, id: item.id }))
    .sort(newestFirst)
    .map(({ item }) => ({
      title: item.title,
      place: 'voices',
      whyNow: `${item.voice} posted this ${daysAgo(now, item.publishedAt)}, so the subject is fresh.`,
      links: item.url ? [{ url: item.url, kind: item.kind }] : [],
      ids: { feedItemId: item.id },
      howToRead: item.howToRead,
    }));

  // Saved sources not used in a post yet: the one waiting longest first.
  const saved: Suggestion[] = sources
    .filter((source) => !source.used)
    .map((source) => ({ source, time: source.savedAt, id: source.id }))
    .sort(oldestFirst)
    .map(({ source }) => ({
      title: source.title,
      place: 'sources',
      whyNow: `Saved ${daysAgo(now, source.savedAt)} and not used in a post yet.`,
      links: source.url ? [{ url: source.url, kind: source.kind }] : [],
      ids: { sourceId: source.id },
      howToRead: source.howToRead,
    }));

  // Open ideas from the list: the oldest first.
  const listed: Suggestion[] = ideas
    .filter((idea) => idea.status === 'open')
    .map((idea) => ({ idea, time: idea.addedAt, id: idea.id }))
    .sort(oldestFirst)
    .map(({ idea }) => ({
      title: idea.text,
      place: 'ideas',
      whyNow: `Added to the ideas list ${daysAgo(now, idea.addedAt)} and still open.`,
      links: [],
      ids: { ideaId: idea.id },
      howToRead: HOW_TO_READ.idea,
    }));

  const byPlace: Record<SuggestionPlace, Suggestion[]> = { voices, sources: saved, ideas: listed };

  // Take turns: the first from each place, then the second from each place,
  // and stop there. A place with more to give still gives no more than that.
  const mixed: Suggestion[] = [];
  for (let round = 0; round < MAX_PER_PLACE; round++) {
    for (const place of PLACES) {
      const next = byPlace[place][round];
      if (next) mixed.push(next);
    }
  }

  return mixed.slice(0, count);
}
