// A mock of the product's API. It keeps everything in memory.
// Each method is where a real client would send an HTTP request, for example:
//   const response = await fetch(`${process.env.DEMO_API_URL}/posts?status=upcoming`, {
//     headers: { Authorization: `Bearer ${apiKey}` },
//   });
// The product rules (time windows, validation) live here, not in the MCP tools.

import { createSeedPosts, seedResults, workspace } from './demo-data.js';
import {
  ApiError,
  type Channel,
  type Network,
  type Post,
  type PostListQuery,
  type PostStatus,
  type SchedulingApi,
} from './scheduling-api.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 31;

/** The longest post text each network accepts, in characters. */
const TEXT_LIMITS: Record<Network, number> = {
  Instagram: 2200,
  LinkedIn: 3000,
  Bluesky: 300,
};

interface DemoApiOptions {
  /** Lets tests fix the clock. */
  now?: () => Date;
}

export function createDemoApi({ now = () => new Date() }: DemoApiOptions = {}): SchedulingApi {
  const posts = createSeedPosts(now());
  let nextDraftNumber = 101;

  /** Posts with this status whose time falls in [from, to), oldest first. */
  function postsBetween(status: PostStatus, from: Date, to: Date) {
    return posts
      .filter((post) => post.status === status && post.time !== null)
      .filter((post) => {
        const time = Date.parse(post.time ?? '');
        return time >= from.getTime() && time < to.getTime();
      })
      .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  }

  return {
    async getWorkspace() {
      return structuredClone(workspace);
    },

    async listPosts(query) {
      if (query.status === 'drafts') {
        const drafts = posts.filter((post) => post.status === 'draft');
        return { window: null, posts: structuredClone(drafts) };
      }

      const { from, to } = resolveWindow(query, now());
      const matches = postsBetween(
        query.status === 'upcoming' ? 'scheduled' : 'published',
        from,
        to,
      );

      return {
        window: { from: from.toISOString(), to: to.toISOString() },
        posts: structuredClone(matches),
      };
    },

    async createDraft({ text, channelIds }) {
      const uniqueIds = [...new Set(channelIds)];
      const channels = uniqueIds.map(findChannel);
      channels.forEach((channel) => checkTextLength(text, channel));

      const draft: Post = {
        id: `post_${nextDraftNumber++}`,
        status: 'draft',
        time: null,
        channelIds: uniqueIds,
        text,
      };
      posts.push(draft);
      return structuredClone(draft);
    },

    async getResults({ days }) {
      const to = now();
      const from = new Date(to.getTime() - days * DAY_MS);
      const published = postsBetween('published', from, to).reverse(); // newest first

      return {
        from: from.toISOString(),
        to: to.toISOString(),
        posts: published.map((post) => ({
          post: structuredClone(post),
          results: structuredClone(seedResults[post.id] ?? []),
        })),
      };
    },
  };
}

function findChannel(id: string) {
  const channel = workspace.channels.find((candidate) => candidate.id === id);
  if (!channel) {
    const known = new Intl.ListFormat('en', { type: 'conjunction' }).format(
      workspace.channels.map((candidate) => `${candidate.id} (${candidate.network})`),
    );
    throw new ApiError(
      'unknown_channel',
      `There is no channel with id "${id}". The channel ids in this workspace are ${known}.`,
    );
  }
  return channel;
}

function checkTextLength(text: string, channel: Channel) {
  const limit = TEXT_LIMITS[channel.network];
  const length = countCharacters(text);
  if (length > limit) {
    throw new ApiError(
      'text_too_long',
      `This draft is ${length} characters long, but ${channel.network} allows ${limit}. Cut at least ${length - limit} characters, or leave the ${channel.network} channel (${channel.id}) out of this draft.`,
    );
  }
}

/**
 * Counts characters the way people see them (grapheme clusters), not UTF-16 code units.
 * "é" written as "e" plus a combining accent is one character, not two.
 */
function countCharacters(text: string) {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
}

/**
 * Works out the time window. Upcoming posts look forward from now,
 * published posts look back from now. A window is at most 31 days long.
 */
function resolveWindow(query: PostListQuery, now: Date) {
  const defaultSpan = DEFAULT_WINDOW_DAYS * DAY_MS;
  let from = query.from ? new Date(query.from) : undefined;
  let to = query.to ? new Date(query.to) : undefined;

  if (query.status === 'upcoming') {
    from ??= to ? new Date(to.getTime() - defaultSpan) : now;
    to ??= new Date(from.getTime() + defaultSpan);
  } else {
    to ??= from ? new Date(from.getTime() + defaultSpan) : now;
    from ??= new Date(to.getTime() - defaultSpan);
  }

  if (from >= to) {
    throw new ApiError(
      'invalid_window',
      `The start of the window (${from.toISOString()}) must be earlier than the end (${to.toISOString()}).`,
    );
  }

  const days = Math.ceil((to.getTime() - from.getTime()) / DAY_MS);
  if (days > MAX_WINDOW_DAYS) {
    throw new ApiError(
      'window_too_long',
      `The window is ${days} days long, but the longest allowed window is ${MAX_WINDOW_DAYS} days. Ask for a shorter window, or make one call per month.`,
    );
  }

  return { from, to };
}
