// @vitest-environment jsdom
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it } from 'vitest';
import { createBoard } from './boardCommit';
import { attachBoardMedia } from './boardMedia';
import { readBoard } from './boardReplica';
import { MAX_UPLOAD_ATTEMPTS, createMediaUploadQueue, type CanvasUploader } from './mediaUploadQueue';
import { ACCOUNT, boardOf, openTestBlobs, openTestStore, sticky, testContext, uuid } from './boardTestkit';

const open: Array<{ close(): void }> = [];
afterEach(() => { for (const handle of open.splice(0)) handle.close(); });

async function boardWithMedia() {
  const db = `queue-${uuid()}`;
  const store = openTestStore(indexedDB, db);
  const blobs = openTestBlobs(indexedDB, `${db}-blobs`);
  open.push(store, blobs);
  const ctx = testContext(store);
  const boardId = uuid();
  await createBoard(ctx, { boardId, destination: ACCOUNT, header: { title: 'Media' }, board: boardOf([sticky(uuid(), 0)]) });
  const media = await attachBoardMedia(ctx, blobs, { boardId, file: new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' }), name: 'p.png' });
  return { store, blobs, ctx, boardId, media };
}

const statusOf = async (store: Parameters<typeof readBoard>[0], boardId: string) => (await readBoard(store, boardId))!.media[0]!.payload;
const uploaded: CanvasUploader = async () => ({ url: 'https://files.example/a', storageKey: 'tenant/private/media/a' });

describe('media upload queue', () => {
  it('does nothing while an upload is not possible', async () => {
    const { ctx, blobs, store, boardId } = await boardWithMedia();
    const queue = createMediaUploadQueue({ ctx, blobs, canUpload: () => false, upload: uploaded });
    expect(await queue.drain()).toEqual({ uploaded: [], retrying: [], failed: [] });
    expect((await statusOf(store, boardId)).status).toBe('local');
  });

  it('retries a failed upload, goes to failed after five attempts (reported), and a manual retry uploads it', async () => {
    const { ctx, blobs, store, boardId, media } = await boardWithMedia();
    const reported: string[] = [];
    let succeed = false;
    const queue = createMediaUploadQueue({
      ctx, blobs, canUpload: () => true, report: (where) => { reported.push(where); },
      upload: async (file) => (succeed ? uploaded(file) : null),
    });

    for (let attempt = 1; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      expect((await queue.drain()).retrying).toEqual([media.mediaId]);
      expect(await statusOf(store, boardId)).toMatchObject({ status: 'local', attempts: attempt });
    }
    expect((await queue.drain()).failed).toEqual([media.mediaId]);
    expect(await statusOf(store, boardId)).toMatchObject({ status: 'failed', attempts: MAX_UPLOAD_ATTEMPTS });
    expect(reported).toEqual(['mediaUploadQueue.exhausted']);
    // A failed item is not drained again by itself.
    expect(await queue.drain()).toEqual({ uploaded: [], retrying: [], failed: [] });

    succeed = true;
    expect((await queue.retry(media.mediaId)).uploaded).toEqual([media.mediaId]);
    expect(await statusOf(store, boardId)).toMatchObject({ status: 'uploaded', storageKey: 'tenant/private/media/a' });
  });

  it('journals the manifest once uploaded, and evicts the local blob only when nothing is owed and the grace has passed', async () => {
    const { ctx, blobs, store, boardId, media } = await boardWithMedia();
    const queue = createMediaUploadQueue({ ctx, blobs, canUpload: () => true, upload: uploaded });
    await queue.drain();
    const owed = await store.read((tx) => tx.pending());
    expect(owed.some((event) => event.entityType === 'canvas-media' && event.clientEntityId === media.mediaId)).toBe(true);

    // Events still pending: the blob stays, whatever the grace.
    expect(await queue.evictUploaded(0)).toEqual([]);
    await store.transact((tx) => tx.acknowledge(owed.map((event) => event.eventId)));
    // Synced, but inside the grace period.
    expect(await queue.evictUploaded()).toEqual([]);
    expect(await blobs.get(media.mediaId)).toBeDefined();
    expect(await queue.evictUploaded(0)).toEqual([media.mediaId]);
    expect(await blobs.get(media.mediaId)).toBeUndefined();
  });
});
