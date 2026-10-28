import { DesignServiceError, type DesignService } from '../design-service.js';
import { ApiError, type DesignAttachment, type PostPicture, type PostStatus } from '../scheduling-api.js';
import { parseDesignRef } from './design-ref.js';
import { createKeyedLock } from './keyed-lock.js';

export const APP_URL = 'https://app.example.com';
export const MAX_PICTURES = 10;
export const HOURLY_LIMIT = 30;
// Below the MCP SDK's default 60-second request timeout, so the person sees
// "took too long" rather than a client-side timeout.
export const OPERATION_DEADLINE_MS = 50_000;
export const SAVE_ATTEMPTS = 3;

const HOUR_MS = 60 * 60_000;

/** What the attacher needs from the product's post storage. */
export interface PostPictureStore {
  read(postId: string): Promise<{ status: PostStatus; revision: number; pictures: PostPicture[] } | undefined>;
  /** Saves only if the post is still at `revision`. False means someone changed it meanwhile. */
  saveIfUnchanged(postId: string, revision: number, pictures: PostPicture[]): Promise<boolean>;
}

interface AttacherOptions {
  store: PostPictureStore;
  designs: DesignService;
  now?: () => number;
  deadlineMs?: number;
}

/**
 * Puts the pages of a Sketchpad design on a draft, as pictures.
 *
 * The order of the work matters. Everything that can be refused cheaply is
 * checked first, and the expensive export comes last. A design that has not
 * changed is never exported again.
 */
export function createDesignAttacher({ store, designs, now = Date.now, deadlineMs = OPERATION_DEADLINE_MS }: AttacherOptions) {
  const withPostLock = createKeyedLock();
  const exportTimes: number[] = [];

  return async function attachDesign(postId: string, designRef: string): Promise<DesignAttachment> {
    const designId = parseDesignRef(designRef);
    if (!designId) {
      throw new ApiError(
        'invalid_design',
        'That is not a Sketchpad design. Send the design id, such as SPfernCare1, or a link that starts with https://sketchpad.example/design/.',
      );
    }

    // Two calls for the same post take turns, so neither loses the other's pictures.
    return withPostLock(postId, () => withDeadline(deadlineMs, (signal) => attach(postId, designId, signal)));
  };

  async function attach(postId: string, designId: string, signal: AbortSignal): Promise<DesignAttachment> {
    const postUrl = `${APP_URL}/posts/${postId}`;

    // 1. Cheap checks first: the post.
    const post = await store.read(postId);
    if (!post) {
      throw new ApiError('unknown_post', `There is no post with id "${postId}". Call list_scheduled_posts with status "drafts" to see the drafts.`);
    }
    if (post.status !== 'draft') {
      throw new ApiError(
        'not_a_draft',
        `Post ${postId} is ${post.status}, not a draft. Pictures can be added only to drafts. If it is scheduled, the user can move it back to drafts in the app: ${postUrl}`,
      );
    }

    // 2. The design, read through the product's own Sketchpad connection.
    // Reading is cheap; only the export is expensive.
    let design;
    try {
      design = await designs.getDesign(designId);
    } catch (error) {
      if (error instanceof DesignServiceError && (error.status === 403 || error.status === 404)) {
        throw new ApiError(
          'design_not_found',
          `Sketchpad cannot find design ${designId} for the connected account. It may be in another Sketchpad account, or deleted. The user can check which account is connected here: ${APP_URL}/connections`,
        );
      }
      throw error;
    }
    if (design.kind !== 'image') {
      throw new ApiError('not_pictures', `"${design.title}" is a video. This tool adds pictures only. The user can add videos in the app: ${postUrl}`);
    }

    // 3. Room on the post, and which pages fit.
    const others = post.pictures.filter((picture) => picture.designId !== designId);
    const room = MAX_PICTURES - others.length;
    if (room <= 0) {
      throw new ApiError('post_full', `Post ${postId} already has ${MAX_PICTURES} pictures, which is the most a post can have. The user can remove some in the app: ${postUrl}`);
    }
    const pages = Array.from({ length: Math.min(design.pageCount, room) }, (_, index) => index + 1);
    const pagesLeftOut = Array.from({ length: design.pageCount - pages.length }, (_, index) => pages.length + index + 1);

    // 4. Nothing to do? Only when every page that fits is on the post, AND
    // the OLDEST of them is not older than the design (Math.min): if even
    // one page is out of date, or missing, the set must be made again.
    const ofThisDesign = post.pictures.filter((picture) => picture.designId === designId);
    const complete = pages.every((page) => ofThisDesign.some((picture) => picture.page === page));
    const oldest = Math.min(...ofThisDesign.map((picture) => Date.parse(picture.revision)));
    if (complete && oldest >= Date.parse(design.updatedAt)) {
      return result(design.title, ofThisDesign, true, pagesLeftOut);
    }

    // 5. The hourly limit guards the expensive export, so a free repeat
    // never meets it. The slot is taken in the same step as the check:
    // calls for other posts run at the same time, and a check now with a
    // count later would let them all through.
    const hourAgo = now() - HOUR_MS;
    while (exportTimes.length && (exportTimes[0] ?? 0) <= hourAgo) exportTimes.shift();
    if (exportTimes.length >= HOURLY_LIMIT) {
      const freeAt = new Date((exportTimes[0] ?? now()) + HOUR_MS).toISOString();
      throw new ApiError('hourly_limit', `${HOURLY_LIMIT} designs were added in the last hour, which is the limit. Try again after ${freeAt}.`);
    }
    stopIfLate(signal);
    exportTimes.push(now());

    // 6. Only now the expensive export. Its slot stays taken, even if the
    // save below fails, because the work was done.
    const exported = await designs.exportPages(designId, pages);
    const fresh: PostPicture[] = exported.map(({ mediaId, page }) => ({ mediaId, designId, page, revision: design.updatedAt }));

    // 7. Save, fenced: only if the post did not change since we read it. If
    // it did, read it again and retry with the SAME exported pictures. A
    // retry never exports again.
    for (let attempt = 1; attempt <= SAVE_ATTEMPTS; attempt++) {
      stopIfLate(signal);
      const current = attempt === 1 ? post : await store.read(postId);
      if (!current || current.status !== 'draft') {
        throw new ApiError('not_a_draft', `Post ${postId} stopped being a draft while the pictures were made. They are in the media library; the user can add them in the app: ${postUrl}`);
      }
      const merged = replaceDesignPictures(current.pictures, designId, fresh);
      if (merged.length > MAX_PICTURES) {
        throw new ApiError('post_full', `Post ${postId} got more pictures meanwhile and has no room left. The new pictures are in the media library: ${postUrl}`);
      }
      // Again, because reading the post took time. A real database would get
      // the deadline inside the save itself, so a save in flight cannot
      // finish after the caller was told "nothing was saved".
      stopIfLate(signal);
      if (await store.saveIfUnchanged(postId, current.revision, merged)) {
        return result(design.title, fresh, false, pagesLeftOut);
      }
    }
    throw new ApiError('post_busy', `Post ${postId} kept changing while the pictures were saved. Try again in a minute. The new pictures are in the media library: ${postUrl}`);

    function result(title: string, pictures: PostPicture[], unchanged: boolean, leftOut: number[]): DesignAttachment {
      return { postId, postUrl, designId, title, pictures, unchanged, pagesLeftOut: leftOut };
    }
  }
}

/**
 * Same design again: its pictures are replaced page for page, in place.
 * Pictures from other designs stay where they are.
 */
export function replaceDesignPictures(current: PostPicture[], designId: string, fresh: PostPicture[]) {
  const byPage = new Map(fresh.map((picture) => [picture.page, picture]));
  const merged: PostPicture[] = [];
  for (const picture of current) {
    if (picture.designId !== designId) {
      merged.push(picture);
      continue;
    }
    const replacement = byPage.get(picture.page);
    if (replacement) {
      merged.push(replacement);
      byPage.delete(picture.page);
    }
    // A page the design no longer has is dropped from the post.
  }
  return [...merged, ...byPage.values()];
}

/**
 * Stops waiting after `ms`, so one slow call cannot hold the post's queue
 * forever. The work itself checks the signal before the export and before
 * every save, so a late run never writes.
 */
async function withDeadline<T>(ms: number, work: (signal: AbortSignal) => Promise<T>) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ApiError('too_slow', 'This took too long, so nothing was saved. Try again in a minute.'));
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

function stopIfLate(signal: AbortSignal) {
  if (signal.aborted) {
    throw new ApiError('too_slow', 'This took too long, so nothing was saved. Try again in a minute.');
  }
}
