import { DesignServiceError, type DesignService } from '../design-service.js';
import { ApiError, type DesignAttachment, type DesignPicture, type PostPicture } from '../scheduling-api.js';
import { parseDesignRef } from './design-ref.js';
import { APP_URL, createPostPictureWriter, MAX_PICTURES, postUrl, stopIfLate, takeHourlySlots, type PostPictureStore } from './post-pictures.js';

export { APP_URL, MAX_PICTURES, OPERATION_DEADLINE_MS, type PostPictureStore } from './post-pictures.js';
export const HOURLY_LIMIT = 30;

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
export function createDesignAttacher({ store, designs, now = Date.now, deadlineMs }: AttacherOptions) {
  const writer = createPostPictureWriter({ store, deadlineMs });
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
    return writer.run(postId, (signal) => attach(postId, designId, signal));
  };

  async function attach(postId: string, designId: string, signal: AbortSignal): Promise<DesignAttachment> {
    const url = postUrl(postId);

    // 1. Cheap checks first: the post.
    const post = await store.read(postId);
    if (!post) {
      throw new ApiError('unknown_post', `There is no post with id "${postId}". Call list_scheduled_posts with status "drafts" to see the drafts.`);
    }
    if (post.status !== 'draft') {
      throw new ApiError(
        'not_a_draft',
        `Post ${postId} is ${post.status}, not a draft. Pictures can be added only to drafts. If it is scheduled, the user can move it back to drafts in the app: ${url}`,
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
      throw new ApiError('not_pictures', `"${design.title}" is a video. This tool adds pictures only. The user can add videos in the app: ${url}`);
    }

    // 3. Room on the post, and which pages fit.
    const isThisDesign = (picture: PostPicture): picture is DesignPicture => picture.kind === 'design' && picture.designId === designId;
    const others = post.pictures.filter((picture) => !isThisDesign(picture));
    const room = MAX_PICTURES - others.length;
    if (room <= 0) {
      throw new ApiError('post_full', `Post ${postId} already has ${MAX_PICTURES} pictures, which is the most a post can have. The user can remove some in the app: ${url}`);
    }
    const pages = Array.from({ length: Math.min(design.pageCount, room) }, (_, index) => index + 1);
    const pagesLeftOut = Array.from({ length: design.pageCount - pages.length }, (_, index) => pages.length + index + 1);

    // 4. Nothing to do? Only when every page that fits is on the post, AND
    // the OLDEST of them is not older than the design (Math.min): if even
    // one page is out of date, or missing, the set must be made again.
    const ofThisDesign = post.pictures.filter(isThisDesign);
    const complete = pages.every((page) => ofThisDesign.some((picture) => picture.page === page));
    const oldest = Math.min(...ofThisDesign.map((picture) => Date.parse(picture.revision)));
    if (complete && oldest >= Date.parse(design.updatedAt)) {
      return result(design.title, ofThisDesign, true, pagesLeftOut);
    }

    // 5. The hourly limit guards the expensive export, so a free repeat
    // never meets it. The slot is taken in the same step as the check:
    // calls for other posts run at the same time, and a check now with a
    // count later would let them all through.
    stopIfLate(signal);
    takeHourlySlots(exportTimes, now(), 1, HOURLY_LIMIT, 'design exports');

    // 6. Only now the expensive export. Its slot stays taken, even if the
    // save below fails, because the work was done.
    const exported = await designs.exportPages(designId, pages);
    const fresh: DesignPicture[] = exported.map(({ mediaId, page }) => ({ kind: 'design', mediaId, designId, page, revision: design.updatedAt }));

    // 7. Save, fenced, with the SAME exported pictures on every try.
    await writer.saveFenced(postId, signal, post, (current) => replaceDesignPictures(current, designId, fresh));
    return result(design.title, fresh, false, pagesLeftOut);

    function result(title: string, pictures: DesignPicture[], unchanged: boolean, leftOut: number[]): DesignAttachment {
      return { postId, postUrl: url, designId, title, pictures, unchanged, pagesLeftOut: leftOut };
    }
  }
}

/**
 * Same design again: its pictures are replaced page for page, in place.
 * Pictures from other designs stay where they are.
 */
export function replaceDesignPictures(current: PostPicture[], designId: string, fresh: DesignPicture[]) {
  const byPage = new Map(fresh.map((picture) => [picture.page, picture]));
  const merged: PostPicture[] = [];
  for (const picture of current) {
    if (picture.kind !== 'design' || picture.designId !== designId) {
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
