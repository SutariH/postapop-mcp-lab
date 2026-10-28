import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../src/demo-api.js';
import { CHECKS_HOURLY_LIMIT } from '../src/pictures/attach-files.js';
import { ApiError, type PictureFile } from '../src/scheduling-api.js';
import { NOW } from './helpers.js';
import { jpeg, png, webp } from './pictures-fixtures.js';

const FILES: Record<string, Buffer> = {
  // p0 … p69: seventy different pictures
  ...Object.fromEntries(Array.from({ length: 70 }, (_, index) => [`p${index}`, png(400 + index, 400)])),
  sunrise: png(1374, 1145),
  shelf: jpeg(1080, 1350),
  leaf: webp(1200, 1200),
  tiny: png(100, 100),
  notes: Buffer.from('just some text'),
};

const file = (id: string): PictureFile => ({ downloadUrl: `https://eu1.files.example/f/${id}`, fileId: id });

/** The demo API, with a stand-in for the chat's file store that serves FILES by id. */
function setup() {
  const download = vi.fn(async ({ fileId }: PictureFile) => {
    const bytes = FILES[fileId];
    if (!bytes) throw new ApiError('download_failed', 'The picture could not be downloaded from the chat.');
    return bytes;
  });
  const api = createDemoApi({ now: () => NOW, downloadFile: download });
  return { api, download };
}

describe('adding pictures from the chat', () => {
  it('adds them to the draft in the order sent', async () => {
    const { api } = setup();
    const result = await api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise'), file('shelf'), file('leaf')] });

    expect(result.added.map((picture) => picture.mediaId)).toEqual(['media_f001', 'media_f002', 'media_f003']);
    expect(result.pictureCount).toBe(3);
  });

  it('adds none when one is refused, and says which one', async () => {
    const { api } = setup();

    await expect(api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise'), file('tiny')] })).rejects.toThrow(
      /^Picture 2 of 2: .*at least 320 pixels.* None of the pictures was added\.$/,
    );
    const again = await api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise')] });
    expect(again.pictureCount).toBe(1);
  });

  it('never adds the same picture twice', async () => {
    const { api } = setup();
    await api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise')] });
    const again = await api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise'), file('shelf'), file('shelf')] });

    expect(again.added).toHaveLength(1);
    expect(again.alreadyOnPost).toBe(1);
    expect(again.pictureCount).toBe(2);
  });

  it('stays safe when the same pictures are sent again to a full post', async () => {
    const { api } = setup();
    const ten = Array.from({ length: 10 }, (_, index) => file(`p${index}`));
    await api.addPicturesToDraft({ postId: 'post_012', files: ten });
    const again = await api.addPicturesToDraft({ postId: 'post_012', files: ten });

    expect(again).toMatchObject({ added: [], alreadyOnPost: 10, pictureCount: 10 });
  });

  it('cancels the other downloads as soon as one fails', async () => {
    const cancelled: string[] = [];
    const download = async ({ fileId }: PictureFile, signal: AbortSignal) => {
      if (fileId === 'broken') throw new ApiError('download_failed', 'The picture could not be downloaded from the chat.');
      await new Promise((_, reject) =>
        signal.addEventListener('abort', () => {
          cancelled.push(fileId);
          reject(new Error('cancelled'));
        }),
      );
      return Buffer.alloc(0);
    };
    const api = createDemoApi({ now: () => NOW, downloadFile: download });

    await expect(api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise'), file('broken'), file('shelf')] })).rejects.toThrow(/could not be downloaded/);
    expect(cancelled.sort()).toEqual(['shelf', 'sunrise']);
  });

  it('limits new pictures per hour, counting only new ones', async () => {
    const { api } = setup();
    for (let draft = 0; draft < 6; draft++) {
      const { id } = await api.createDraft({ text: `Draft ${draft}`, channelIds: [] });
      const files = Array.from({ length: 10 }, (_, index) => file(`p${draft * 10 + index}`));
      await api.addPicturesToDraft({ postId: id, files });
    }
    const { id } = await api.createDraft({ text: 'One more', channelIds: [] });

    await expect(api.addPicturesToDraft({ postId: id, files: [file('p60')] })).rejects.toThrow(/limit of 60 new pictures an hour/);
    // A repeat of pictures already on a post adds nothing, so it is not refused.
    await expect(api.addPicturesToDraft({ postId: 'post_101', files: [file('p0')] })).resolves.toMatchObject({ added: [] });
  });

  it('refuses a scheduled post before downloading anything', async () => {
    const { api, download } = setup();

    await expect(api.addPicturesToDraft({ postId: 'post_007', files: [file('sunrise')] })).rejects.toThrow(/not a draft/);
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses more than 10 pictures in one call, before downloading', async () => {
    const { api, download } = setup();
    const eleven = Array.from({ length: 11 }, (_, index) => file(`p${index}`));

    await expect(api.addPicturesToDraft({ postId: 'post_012', files: eleven })).rejects.toThrow(/11 pictures were sent, but a post holds at most 10/);
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses new pictures that do not fit, and adds none of them', async () => {
    const { api } = setup();
    await api.addPicturesToDraft({ postId: 'post_012', files: Array.from({ length: 8 }, (_, index) => file(`p${index}`)) });

    await expect(api.addPicturesToDraft({ postId: 'post_012', files: [file('p8'), file('p9'), file('p10')] })).rejects.toThrow(/room for 2 more pictures, and 3 new ones were sent/);
  });

  it('limits downloads and checks per hour, counting refused files too', async () => {
    const { api, download } = setup();
    for (let call = 0; call < CHECKS_HOURLY_LIMIT / 10; call++) {
      const tenTinyOnes = Array.from({ length: 10 }, () => file('tiny'));
      await expect(api.addPicturesToDraft({ postId: 'post_012', files: tenTinyOnes })).rejects.toThrow(/at least 320 pixels/);
    }

    await expect(api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise')] })).rejects.toThrow(/limit of 200 downloads and checks an hour/);
    expect(download).toHaveBeenCalledTimes(CHECKS_HOURLY_LIMIT);
  });

  it('records the call', async () => {
    const { api } = setup();
    await api.addPicturesToDraft({ postId: 'post_012', files: [file('sunrise')] });
    await api.addPicturesToDraft({ postId: 'post_012', files: [file('notes')] }).catch(() => undefined);

    expect((await api.getActivity()).map(({ tool, outcome }) => `${tool} ${outcome}`)).toEqual([
      'add_pictures_to_post ok',
      'add_pictures_to_post refused',
    ]);
  });
});

describe('the add_pictures_to_post schema', () => {
  it('declares all four file fields, and requires only download_url and file_id', async () => {
    const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
    const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
    const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
    const { createServer } = await import('../src/server.js');
    const server: InstanceType<typeof McpServer> = createServer(createDemoApi({ now: () => NOW }), { files: true });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: 'schema-test', version: '1.0.0' });
    await client.connect(clientSide);
    const { tools } = await client.listTools();
    await client.close();

    const tool = tools.find((candidate) => candidate.name === 'add_pictures_to_post');
    const item = (tool?.inputSchema.properties?.pictures as { items: { properties: object; required: string[] } }).items;
    expect(Object.keys(item.properties).sort()).toEqual(['download_url', 'file_id', 'file_name', 'mime_type']);
    expect(item.required.sort()).toEqual(['download_url', 'file_id']);
    expect(tool?._meta).toEqual({ 'openai/fileParams': ['pictures'] });
  });
});
