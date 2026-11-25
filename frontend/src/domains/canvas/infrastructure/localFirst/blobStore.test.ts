// @vitest-environment jsdom
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { BLOB_CAPS, BlobQuotaError, admitBlob, createBlobStore, type BlobStore, type OpfsDirectory } from './blobStore';
import { uuid } from './boardTestkit';

const open: BlobStore[] = [];
afterEach(() => { for (const store of open.splice(0)) store.close(); });

const bytes = (n: number, type = 'image/png'): Blob => new Blob([new Uint8Array(n).fill(7)], { type });
const hash = async (data: ArrayBuffer): Promise<string> => `sha:${data.byteLength}`;
const small = { fileBytes: 10, videoBytes: 20, partitionBytes: 25 };

function fakeOpfs(): { files: Map<string, Blob>; dir: OpfsDirectory } {
  const files = new Map<string, Blob>();
  const dir: OpfsDirectory = {
    async getFileHandle(name, options) {
      if (!files.has(name) && !options?.create) throw Object.assign(new Error('missing'), { name: 'NotFoundError' });
      return {
        async createWritable() { return { async write(data: Blob) { files.set(name, data); }, async close() { /* nothing to flush */ } }; },
        async getFile() { return files.get(name)!; },
      };
    },
    async removeEntry(name) { files.delete(name); },
  };
  return { files, dir };
}

function makeStore(extra: Partial<Parameters<typeof createBlobStore>[0]> = {}): BlobStore {
  const store = createBlobStore({ indexedDB, dbName: `blobs-${uuid()}`, opfs: null, estimate: async () => undefined, hash, ...extra });
  open.push(store);
  return store;
}

describe('admitBlob', () => {
  it('applies the 25 MB / 200 MB / 500 MB caps and the browser estimate', () => {
    expect(admitBlob({ bytes: BLOB_CAPS.fileBytes + 1, mimeType: 'image/png' }, 0)).toBe('file-too-large');
    expect(admitBlob({ bytes: BLOB_CAPS.fileBytes + 1, mimeType: 'video/mp4' }, 0)).toBeUndefined();
    expect(admitBlob({ bytes: BLOB_CAPS.videoBytes + 1, mimeType: 'video/mp4' }, 0)).toBe('video-too-large');
    expect(admitBlob({ bytes: 10, mimeType: 'image/png' }, BLOB_CAPS.partitionBytes)).toBe('partition-full');
    expect(admitBlob({ bytes: 10, mimeType: 'image/png' }, 0, { quota: 100, usage: 95 })).toBe('storage-full');
  });
});

describe('blob store', () => {
  it('stores, reads, measures and deletes', async () => {
    const store = makeStore();
    const info = await store.put('a', bytes(4));
    expect(info).toMatchObject({ id: 'a', bytes: 4, sha256: 'sha:4', mimeType: 'image/png' });
    expect((await (await store.get('a'))!.arrayBuffer()).byteLength).toBe(4);
    expect(await store.usage()).toBe(4);
    await store.delete('a');
    expect(await store.get('a')).toBeUndefined();
    expect(await store.usage()).toBe(0);
  });

  it('refuses over a cap with the quota-exceeded state, never storing a copy', async () => {
    const store = makeStore({ caps: small });
    await expect(store.put('big', bytes(11))).rejects.toMatchObject({ state: 'quota-exceeded', reason: 'file-too-large' });
    await expect(store.put('film', bytes(21, 'video/mp4'))).rejects.toBeInstanceOf(BlobQuotaError);
    await store.put('one', bytes(10));
    await store.put('two', bytes(10));
    await expect(store.put('three', bytes(10))).rejects.toMatchObject({ reason: 'partition-full' });
    expect(await store.get('three')).toBeUndefined();
    await store.put('one', bytes(10));
    expect(await store.usage()).toBe(20);
  });

  it('refuses when the browser says there is no room', async () => {
    const store = makeStore({ estimate: async () => ({ quota: 100, usage: 99 }) });
    await expect(store.put('x', bytes(5))).rejects.toMatchObject({ reason: 'storage-full' });
  });

  it('keeps large blobs in OPFS and only metadata in IndexedDB', async () => {
    const { files, dir } = fakeOpfs();
    const store = makeStore({ opfs: dir, opfsThresholdBytes: 5 });
    await store.put('large', bytes(8));
    await store.put('tiny', bytes(2));
    expect([...files.keys()]).toEqual(['large']);
    expect((await (await store.get('large'))!.arrayBuffer()).byteLength).toBe(8);
    expect(await store.usage()).toBe(10);
    await store.delete('large');
    expect(files.size).toBe(0);
    expect(await store.get('large')).toBeUndefined();
  });
});
