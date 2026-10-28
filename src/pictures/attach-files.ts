import { createHash } from 'node:crypto';
import { ApiError, type FilePicture, type FilesAttachment, type PictureFile } from '../scheduling-api.js';
import { inspectPicture } from './picture-bytes.js';
import { createPostPictureWriter, MAX_PICTURES, postUrl, stopIfLate, takeHourlySlots, type PostPictureStore } from './post-pictures.js';

/** Downloads and checks an hour. Every file counts, even one that is refused later. */
export const CHECKS_HOURLY_LIMIT = 200;
/** New pictures an hour. Only pictures that are really added count. */
export const PICTURES_HOURLY_LIMIT = 60;

interface FileAttacherOptions {
  store: PostPictureStore;
  download: (file: PictureFile, signal: AbortSignal) => Promise<Buffer>;
  /** Stores the checked bytes in the product's media library and returns the new media id. */
  saveMedia: (bytes: Buffer) => Promise<string>;
  now?: () => number;
  deadlineMs?: number;
}

/**
 * Puts pictures that the chat client handed over as files on a draft.
 *
 * All or nothing: the files are a carousel in a chosen order, so if one is
 * refused, none is added. The person fixes that one and sends them again.
 */
export function createFileAttacher({ store, download, saveMedia, now = Date.now, deadlineMs }: FileAttacherOptions) {
  const writer = createPostPictureWriter({ store, deadlineMs });
  const checkTimes: number[] = [];
  const pictureTimes: number[] = [];

  return function attachFiles(postId: string, files: PictureFile[]) {
    return writer.run(postId, async (signal): Promise<FilesAttachment> => {
      const url = postUrl(postId);

      // 1. The post, before anything is downloaded.
      const post = await store.read(postId);
      if (!post) {
        throw new ApiError('unknown_post', `There is no post with id "${postId}". Call list_scheduled_posts with status "drafts" to see the drafts.`);
      }
      if (post.status !== 'draft') {
        throw new ApiError('not_a_draft', `Post ${postId} is ${post.status}, not a draft. Pictures can be added only to drafts. If it is scheduled, the user can move it back to drafts in the app: ${url}`);
      }
      // The exact room check comes after the duplicates are known (step 5):
      // sending the same pictures again to a full post must stay safe.
      if (files.length > MAX_PICTURES) {
        throw new ApiError('too_many', `${files.length} pictures were sent, but a post holds at most ${MAX_PICTURES}. Send at most ${MAX_PICTURES}.`);
      }

      // 2. A limit on downloads and checks, before the first download. The
      // picture limit below counts only what is added, so without this one,
      // refused files could be downloaded and checked without end.
      takeHourlySlots(checkTimes, now(), files.length, CHECKS_HOURLY_LIMIT, 'downloads and checks');

      // 3. Download all at once: the links last only a few minutes. The first
      // failure stops the call AND cancels the other downloads.
      const cancel = new AbortController();
      const both = AbortSignal.any([signal, cancel.signal]);
      const downloads = files.map((file) =>
        download(file, both).catch((error: unknown) => {
          cancel.abort();
          throw error;
        }),
      );
      downloads.forEach((pending) => pending.catch(() => undefined));
      const contents = await Promise.all(downloads);
      stopIfLate(signal);

      // 4. Check each file, in order, and stop at the first refusal.
      const checked = files.map((file, index) => {
        const bytes = contents[index]!;
        try {
          inspectPicture(bytes, file.mimeType);
        } catch (error) {
          if (error instanceof ApiError && files.length > 1) {
            throw new ApiError(error.code, `Picture ${index + 1} of ${files.length}: ${error.message} None of the pictures was added.`);
          }
          throw error;
        }
        return { file, bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
      });

      // 5. The same picture is never added twice: not if it is on the post
      // already, and not if it was sent twice in this call.
      const onPost = new Set(post.pictures.flatMap((picture) => (picture.kind === 'file' ? [picture.sha256] : [])));
      const alreadyOnPost = checked.filter(({ sha256 }) => onPost.has(sha256)).length;
      const seen = new Set<string>();
      const fresh = checked.filter(({ sha256 }) => {
        if (onPost.has(sha256) || seen.has(sha256)) return false;
        seen.add(sha256);
        return true;
      });
      const room = MAX_PICTURES - post.pictures.length;
      if (fresh.length > room) {
        throw new ApiError('post_full', `Post ${postId} has room for ${room} more ${room === 1 ? 'picture' : 'pictures'}, and ${fresh.length} new ones were sent. Send at most ${room}, or the user can remove some in the app: ${url}`);
      }

      // 6. The picture limit counts the new pictures that passed every
      // check. They are stored now, so they count even if the save fails.
      // (A real product strips metadata here too: see the README.)
      takeHourlySlots(pictureTimes, now(), fresh.length, PICTURES_HOURLY_LIMIT, 'new pictures');
      stopIfLate(signal);
      const added: FilePicture[] = [];
      for (const { file, bytes, sha256 } of fresh) {
        added.push({ kind: 'file', mediaId: await saveMedia(bytes), sha256, fileName: file.fileName ?? null });
      }

      // 7. Append in the order sent; pictures already on the post keep their place.
      const merged = await writer.saveFenced(postId, signal, post, (current) => {
        const present = new Set(current.flatMap((picture) => (picture.kind === 'file' ? [picture.sha256] : [])));
        return [...current, ...added.filter((picture) => !present.has(picture.sha256))];
      });
      // Report only what really is on the post: a retry may have found a picture there already.
      const saved = new Set(merged.map((picture) => picture.mediaId));
      return { postId, postUrl: url, added: added.filter((picture) => saved.has(picture.mediaId)), alreadyOnPost, pictureCount: merged.length };
    });
  };
}
