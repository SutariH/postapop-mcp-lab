import { describe, expect, it } from 'vitest';
import { createMockDesignService, type DesignService } from '../src/design-service.js';
import { createDesignAttacher, HOURLY_LIMIT, replaceDesignPictures, type PostPictureStore } from '../src/pictures/attach-design.js';
import type { DesignPicture, PostPicture, PostStatus } from '../src/scheduling-api.js';

const NOW = Date.parse('2026-11-02T12:00:00Z');
const OLD = '2026-10-31T12:00:00.000Z';
const NEWER = '2026-11-01T12:00:00.000Z';

function designs(extra: Array<{ id: string; pageCount?: number; kind?: 'image' | 'video'; owner?: string }> = []) {
  return [
    { id: 'SPfernCare1', title: 'Fern care in 3 slides', kind: 'image' as const, pageCount: 3, updatedAt: OLD, owner: 'shop' },
    { id: 'SPwinterSal', title: 'Winter sale catalog', kind: 'image' as const, pageCount: 14, updatedAt: OLD, owner: 'shop' },
    { id: 'SPrepotReel', title: 'Repotting in 30 seconds', kind: 'video' as const, pageCount: 1, updatedAt: OLD, owner: 'shop' },
    { id: 'SPotherAcct', title: 'A poster in another account', kind: 'image' as const, pageCount: 1, updatedAt: OLD, owner: 'someone-else' },
    ...extra.map((design) => ({ title: design.id, kind: 'image' as const, pageCount: 1, updatedAt: OLD, owner: 'shop', ...design })),
  ];
}

/** An in-memory post store that the tests can look into and interfere with. */
function memoryStore(status: PostStatus = 'draft') {
  const post = { status, revision: 0, pictures: [] as PostPicture[] };
  const store: PostPictureStore & { post: typeof post; saves: number; failNextSave: boolean } = {
    post,
    saves: 0,
    failNextSave: false,
    async read() {
      return structuredClone(post);
    },
    async saveIfUnchanged(_postId, revision, pictures) {
      store.saves++;
      if (store.failNextSave) {
        // Someone edited the post in the app at this very moment.
        store.failNextSave = false;
        post.revision++;
        return false;
      }
      if (revision !== post.revision) return false;
      post.pictures = structuredClone(pictures);
      post.revision++;
      return true;
    },
  };
  return store;
}

function setup(options: { status?: PostStatus; service?: DesignService & { exports: string[] }; deadlineMs?: number } = {}) {
  const store = memoryStore(options.status);
  const service = options.service ?? createMockDesignService({ designs: designs(), connectedAccount: 'shop' });
  const attach = createDesignAttacher({ store, designs: service, now: () => NOW, deadlineMs: options.deadlineMs });
  return { store, service, attach };
}

/** The test posts hold design pictures only. */
const designPictures = (store: { post: { pictures: PostPicture[] } }) => store.post.pictures as DesignPicture[];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('adding a design to a draft', () => {
  it('puts each page on the post as a picture', async () => {
    const { attach, store } = setup();
    const result = await attach('post_012', 'https://sketchpad.example/design/SPfernCare1/edit');

    expect(result.pictures.map((picture) => picture.page)).toEqual([1, 2, 3]);
    expect(store.post.pictures).toHaveLength(3);
  });

  it('refuses a scheduled post before it exports anything', async () => {
    const { attach, service } = setup({ status: 'scheduled' });

    await expect(attach('post_007', 'SPfernCare1')).rejects.toThrow(/not a draft.*https:\/\/app\.example\.com\/posts\/post_007/);
    expect(service.exports).toEqual([]);
  });

  it('says "another account or deleted" for a design it cannot read, with a link to the connection', async () => {
    const { attach, service } = setup();

    await expect(attach('post_012', 'SPotherAcct')).rejects.toThrow(/another Sketchpad account, or deleted.*\/connections/);
    await expect(attach('post_012', 'SPnoSuchOne')).rejects.toThrow(/another Sketchpad account, or deleted/);
    expect(service.exports).toEqual([]);
  });

  it('refuses a video without exporting it', async () => {
    const { attach, service } = setup();

    await expect(attach('post_012', 'SPrepotReel')).rejects.toThrow(/is a video/);
    expect(service.exports).toEqual([]);
  });

  it('takes the first 10 pages of a long design and names the pages left out', async () => {
    const { attach } = setup();
    const result = await attach('post_012', 'SPwinterSal');

    expect(result.pictures).toHaveLength(10);
    expect(result.pagesLeftOut).toEqual([11, 12, 13, 14]);
  });
});

describe('the same design again', () => {
  it('costs nothing when the design has not changed', async () => {
    const { attach, service } = setup();
    await attach('post_012', 'SPfernCare1');
    const again = await attach('post_012', 'SPfernCare1');

    expect(again.unchanged).toBe(true);
    expect(service.exports).toEqual(['SPfernCare1']);
  });

  it('still names the pages left out when nothing changed', async () => {
    const { attach, service } = setup();
    await attach('post_012', 'SPwinterSal');
    const again = await attach('post_012', 'SPwinterSal');

    expect(again).toMatchObject({ unchanged: true, pagesLeftOut: [11, 12, 13, 14] });
    expect(service.exports).toEqual(['SPwinterSal']);
  });

  it('makes the set again when a page is missing from the post', async () => {
    const { attach, store, service } = setup();
    await attach('post_012', 'SPfernCare1');
    store.post.pictures = designPictures(store).filter((picture) => picture.page !== 2); // removed in the app

    const again = await attach('post_012', 'SPfernCare1');
    expect(again.unchanged).toBe(false);
    expect(designPictures(store).map((picture) => picture.page)).toEqual([1, 3, 2]);
    expect(service.exports).toEqual(['SPfernCare1', 'SPfernCare1']);
  });

  it('replaces its pictures in place when the design changed', async () => {
    const list = designs();
    const service = createMockDesignService({ designs: list, connectedAccount: 'shop' });
    const { attach, store } = setup({ service });
    const first = await attach('post_012', 'SPfernCare1');
    list[0]!.updatedAt = NEWER;
    const second = await attach('post_012', 'SPfernCare1');

    expect(second.unchanged).toBe(false);
    expect(designPictures(store).map((picture) => picture.page)).toEqual([1, 2, 3]);
    expect(designPictures(store).map((picture) => picture.mediaId)).not.toEqual(first.pictures.map((picture) => picture.mediaId));
  });

  it('decides "unchanged" by the OLDEST picture, not the newest', async () => {
    const list = designs();
    list[0]!.updatedAt = '2026-11-01T00:00:00.000Z';
    const service = createMockDesignService({ designs: list, connectedAccount: 'shop' });
    const { attach, store } = setup({ service });
    // Page 1 was exported after the last change, page 2 before it.
    store.post.pictures = [
      { kind: 'design', mediaId: 'media_a', designId: 'SPfernCare1', page: 1, revision: NEWER },
      { kind: 'design', mediaId: 'media_b', designId: 'SPfernCare1', page: 2, revision: OLD },
    ];
    const result = await attach('post_012', 'SPfernCare1');

    expect(result.unchanged).toBe(false);
    expect(service.exports).toEqual(['SPfernCare1']);
  });
});

describe('robustness', () => {
  it('lets two calls for one post take turns, so no picture is lost', async () => {
    const service = createMockDesignService({
      designs: designs([{ id: 'SPshopFront', pageCount: 2 }]),
      connectedAccount: 'shop',
      beforeExport: () => sleep(20),
    });
    const { attach, store } = setup({ service });
    await Promise.all([attach('post_012', 'SPfernCare1'), attach('post_012', 'SPshopFront')]);

    expect(designPictures(store).map((picture) => picture.designId)).toEqual(['SPfernCare1', 'SPfernCare1', 'SPfernCare1', 'SPshopFront', 'SPshopFront']);
  });

  it('exports a design once when the same call arrives twice at once', async () => {
    const service = createMockDesignService({ designs: designs(), connectedAccount: 'shop', beforeExport: () => sleep(20) });
    const { attach } = setup({ service });
    const [, second] = await Promise.all([attach('post_012', 'SPfernCare1'), attach('post_012', 'SPfernCare1')]);

    expect(service.exports).toEqual(['SPfernCare1']);
    expect(second.unchanged).toBe(true);
  });

  it('retries a save that met a change, with the same exported pictures', async () => {
    const { attach, store, service } = setup();
    store.failNextSave = true;
    const result = await attach('post_012', 'SPfernCare1');

    expect(store.saves).toBe(2);
    expect(service.exports).toEqual(['SPfernCare1']);
    expect(designPictures(store).map((picture) => picture.mediaId)).toEqual(result.pictures.map((picture) => picture.mediaId));
  });

  it('stops a slow call, frees the queue, and never saves late', async () => {
    let slow = true;
    const service = createMockDesignService({
      designs: designs([{ id: 'SPshopFront', pageCount: 2 }]),
      connectedAccount: 'shop',
      beforeExport: async () => {
        if (slow) {
          slow = false;
          await sleep(150);
        }
      },
    });
    const { attach, store } = setup({ service, deadlineMs: 50 });
    const started = Date.now();

    await expect(attach('post_012', 'SPfernCare1')).rejects.toThrow(/took too long/);
    await attach('post_012', 'SPshopFront');
    // The queue moved on at the deadline, long before the slow export ended.
    expect(Date.now() - started).toBeLessThan(140);
    await sleep(200); // the slow export finishes now, but must not write

    expect(designPictures(store).map((picture) => picture.designId)).toEqual(['SPshopFront', 'SPshopFront']);
  });

  it('keeps the hourly limit when many calls for different posts arrive at once', async () => {
    const posts = new Map<string, { revision: number; pictures: PostPicture[] }>();
    const store: PostPictureStore = {
      async read(postId) {
        const post = posts.get(postId) ?? { revision: 0, pictures: [] };
        return { status: 'draft', ...structuredClone(post) };
      },
      async saveIfUnchanged(postId, revision, pictures) {
        if ((posts.get(postId)?.revision ?? 0) !== revision) return false;
        posts.set(postId, { revision: revision + 1, pictures });
        return true;
      },
    };
    const service = createMockDesignService({ designs: designs(), connectedAccount: 'shop', beforeExport: () => sleep(10) });
    const attach = createDesignAttacher({ store, designs: service, now: () => NOW });
    const calls = Array.from({ length: HOURLY_LIMIT + 5 }, (_, index) => attach(`post_${index}`, 'SPfernCare1'));
    const outcomes = await Promise.allSettled(calls);

    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(5);
    expect(service.exports).toHaveLength(HOURLY_LIMIT);
  });

  it('never refuses a repeat that costs nothing, even at the hourly limit', async () => {
    let version = 0;
    const exports: string[] = [];
    const service: DesignService & { exports: string[] } = {
      exports,
      getDesign: async (id) => ({ id, title: id, kind: 'image', pageCount: 1, updatedAt: id === 'SPfernCare1' ? OLD : new Date(NOW + ++version).toISOString() }),
      exportPages: async (id, pages) => {
        exports.push(id);
        return pages.map((page) => ({ mediaId: `media_${exports.length}`, page }));
      },
    };
    const { attach } = setup({ service });
    await attach('post_012', 'SPfernCare1');
    for (let call = 1; call < HOURLY_LIMIT; call++) await attach('post_012', 'SPwinterSal');

    await expect(attach('post_012', 'SPwinterSal')).rejects.toThrow(/over the limit of 30 design exports an hour/);
    expect((await attach('post_012', 'SPfernCare1')).unchanged).toBe(true);
  });

  it('gives the hourly slot back when a call stops before the export', async () => {
    const { attach, service } = setup();
    for (let call = 0; call < HOURLY_LIMIT + 5; call++) {
      await expect(attach('post_012', 'SPrepotReel')).rejects.toThrow(/is a video/);
    }
    await attach('post_012', 'SPfernCare1');

    expect(service.exports).toEqual(['SPfernCare1']);
  });

  it(`refuses the ${HOURLY_LIMIT + 1}st design in an hour before exporting it`, async () => {
    let version = 0;
    const exports: string[] = [];
    const service: DesignService & { exports: string[] } = {
      exports,
      // Always "changed", so every call really exports.
      getDesign: async (id) => ({ id, title: id, kind: 'image', pageCount: 1, updatedAt: new Date(NOW + ++version).toISOString() }),
      exportPages: async (id, pages) => {
        exports.push(id);
        return pages.map((page) => ({ mediaId: `media_${exports.length}`, page }));
      },
    };
    const { attach } = setup({ service });
    for (let call = 0; call < HOURLY_LIMIT; call++) await attach('post_012', 'SPfernCare1');

    await expect(attach('post_012', 'SPfernCare1')).rejects.toThrow(/over the limit of 30 design exports an hour/);
    expect(exports).toHaveLength(HOURLY_LIMIT);
  });
});

describe('replaceDesignPictures', () => {
  it('keeps pictures that came as files where they are', () => {
    const current: PostPicture[] = [
      { kind: 'file', mediaId: 'media_f1', sha256: 'abc', fileName: 'shop.png' },
      { kind: 'design', mediaId: 'media_1', designId: 'SPfernCare1', page: 1, revision: OLD },
    ];
    const fresh: DesignPicture[] = [{ kind: 'design', mediaId: 'media_2', designId: 'SPfernCare1', page: 1, revision: NEWER }];

    expect(replaceDesignPictures(current, 'SPfernCare1', fresh).map((picture) => picture.mediaId)).toEqual(['media_f1', 'media_2']);
  });
});
