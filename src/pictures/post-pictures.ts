import { ApiError, type PostPicture, type PostStatus } from '../scheduling-api.js';
import { createKeyedLock } from './keyed-lock.js';

// The step that both picture tools share: wait for the post's turn, stop at
// the deadline, and save without losing a change made meanwhile. It moved
// here from attach-design.ts when the second tool needed it.

export const APP_URL = 'https://app.example.com';
export const MAX_PICTURES = 10;
// Below the MCP SDK's default 60-second request timeout, so the person sees
// "took too long" rather than a client-side timeout.
export const OPERATION_DEADLINE_MS = 50_000;
export const SAVE_ATTEMPTS = 3;
export const HOUR_MS = 60 * 60_000;

export const postUrl = (postId: string) => `${APP_URL}/posts/${postId}`;

/** What the picture tools need from the product's post storage. */
export interface PostPictureStore {
  read(postId: string): Promise<{ status: PostStatus; revision: number; pictures: PostPicture[] } | undefined>;
  /** Saves only if the post is still at `revision`. False means someone changed it meanwhile. */
  saveIfUnchanged(postId: string, revision: number, pictures: PostPicture[]): Promise<boolean>;
}

type Snapshot = NonNullable<Awaited<ReturnType<PostPictureStore['read']>>>;

export function createPostPictureWriter({ store, deadlineMs = OPERATION_DEADLINE_MS }: { store: PostPictureStore; deadlineMs?: number }) {
  const withPostLock = createKeyedLock();

  return {
    /** Calls for the same post take turns, and each stops at the deadline. */
    run<T>(postId: string, work: (signal: AbortSignal) => Promise<T>) {
      return withPostLock(postId, () => withDeadline(deadlineMs, work));
    },

    /**
     * Saves `merge(current pictures)`, fenced: only if the post did not
     * change since it was read. If it did, it reads the post again and
     * merges the SAME new pictures into it, up to three times. A retry never
     * makes new pictures.
     */
    async saveFenced(postId: string, signal: AbortSignal, first: Snapshot, merge: (current: PostPicture[]) => PostPicture[]) {
      const url = postUrl(postId);
      for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
        stopIfLate(signal);
        const current = attempt === 1 ? first : await store.read(postId);
        if (!current || current.status !== 'draft') {
          throw new ApiError('not_a_draft', `Post ${postId} stopped being a draft while the pictures were made. They are in the media library; the user can add them in the app: ${url}`);
        }
        const merged = merge(current.pictures);
        if (merged.length > MAX_PICTURES) {
          throw new ApiError('post_full', `Post ${postId} got more pictures meanwhile and has no room left. The new pictures are in the media library: ${url}`);
        }
        // Again, because reading the post took time. A real database would get
        // the deadline inside the save itself, so a save in flight cannot
        // finish after the caller was told "nothing was saved".
        stopIfLate(signal);
        if (await store.saveIfUnchanged(postId, current.revision, merged)) {
          return merged;
        }
      }
      throw new ApiError('post_busy', `Post ${postId} kept changing while the pictures were saved. Try again in a minute. The new pictures are in the media library: ${url}`);
    },
  };
}

/** Takes one slot in an hourly window, or refuses. Check and take happen in one step, with no await between. */
export function takeHourlySlots(times: number[], now: number, count: number, limit: number, what: string) {
  while (times.length && (times[0] ?? 0) <= now - HOUR_MS) times.shift();
  if (times.length + count > limit) {
    const freeAt = new Date((times[0] ?? now) + HOUR_MS).toISOString();
    throw new ApiError('hourly_limit', `This would go over the limit of ${limit} ${what} an hour. Try again after ${freeAt}.`);
  }
  for (let slot = 0; slot < count; slot++) times.push(now);
}

/**
 * Stops waiting after `ms`, so one slow call cannot hold the post's queue
 * forever. The work itself checks the signal before each expensive step and
 * before every save, so a late run never writes.
 */
async function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(tooSlow());
    }, ms);
  });
  const job = work(controller.signal);
  job.catch(() => undefined); // a late failure has nobody left to tell
  try {
    return await Promise.race([job, late]);
  } finally {
    clearTimeout(timer);
  }
}

export function stopIfLate(signal: AbortSignal) {
  if (signal.aborted) throw tooSlow();
}

const tooSlow = () => new ApiError('too_slow', 'This took too long, so nothing was saved. Try again in a minute.');
