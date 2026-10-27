// A mock of the product's API. It keeps everything in memory.
// Each method is where a real client would send an HTTP request, for example:
//   const response = await fetch(`${process.env.DEMO_API_URL}/posts?status=upcoming`, {
//     headers: { Authorization: `Bearer ${apiKey}` },
//   });
// The product rules (time windows, validation) live here, not in the MCP tools.

import { createSeedPosts, workspace } from './demo-data.js';
import { ApiError, type PostListQuery, type SchedulingApi } from './scheduling-api.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 31;

interface DemoApiOptions {
  /** Lets tests fix the clock. */
  now?: () => Date;
}

export function createDemoApi({ now = () => new Date() }: DemoApiOptions = {}): SchedulingApi {
  const posts = createSeedPosts(now());

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
      const wanted = query.status === 'upcoming' ? 'scheduled' : 'published';
      const matches = posts
        .filter((post) => post.status === wanted && post.time !== null)
        .filter((post) => {
          const time = Date.parse(post.time!);
          return time >= from.getTime() && time < to.getTime();
        })
        .sort((a, b) => a.time!.localeCompare(b.time!));

      return {
        window: { from: from.toISOString(), to: to.toISOString() },
        posts: structuredClone(matches),
      };
    },
  };
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
