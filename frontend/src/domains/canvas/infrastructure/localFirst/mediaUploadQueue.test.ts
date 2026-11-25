// @vitest-environment jsdom
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBoard } from './boardCommit';
import { attachBoardMedia } from './boardMedia';
import { readBoard } from './boardReplica';
import { MAX_UPLOAD_ATTEMPTS, UPLOAD_BACKOFF_BASE_MS, UPLOAD_BACKOFF_MAX_MS, createMediaUploadQueue, uploadBackoffMs, type CanvasUploader } from './mediaUploadQueue';
import { listBoardMediaIssues } from './mediaUploadStatus';
import { ACCOUNT, AT, boardOf, openTestBlobs, openTestStore, sticky, testContext, uuid } from './boardTestkit';

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
    const queue = createMediaUploadQueue({ ctx, blobs, activeTenantId: () => undefined, upload: uploaded });
    expect(await queue.drain()).toEqual({ uploaded: [], retrying: [], failed: [] });
    expect((await statusOf(store, boardId)).status).toBe('local');
  });

  it('retries a failed upload, goes to failed after five attempts (reported), and a manual retry uploads it', async () => {
    const { ctx: base, blobs, store, boardId, media } = await boardWithMedia();
    // A clock the test moves: a failed upload waits out its backoff before the next drain tries it.
    let clock = new Date(AT).getTime();
    const ctx = { ...base, now: () => new Date(clock) };
    const reported: string[] = [];
    let succeed = false;
    const queue = createMediaUploadQueue({
      ctx, blobs, activeTenantId: () => 'tenant-1', report: (where) => { reported.push(where); },
      upload: async (file, scope) => (succeed ? uploaded(file, scope) : null),
    });

    for (let attempt = 1; attempt < MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      expect((await queue.drain()).retrying).toEqual([media.mediaId]);
      expect(await statusOf(store, boardId)).toMatchObject({ status: 'local', attempts: attempt });
      clock += UPLOAD_BACKOFF_MAX_MS;
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
    const queue = createMediaUploadQueue({ ctx, blobs, activeTenantId: () => 'tenant-1', upload: uploaded });
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

  it('only uploads media that belongs to the active workspace, and sends the workspace with the file', async () => {
    const { ctx, blobs, store, boardId } = await boardWithMedia();
    const scopes: string[] = [];
    const other = createMediaUploadQueue({ ctx, blobs, activeTenantId: () => 'tenant-2', upload: async (file, scope) => { scopes.push(scope.tenantId); return uploaded(file, scope); } });
    expect(await other.drain()).toEqual({ uploaded: [], retrying: [], failed: [] });
    expect((await statusOf(store, boardId)).status).toBe('local');
    const mine = createMediaUploadQueue({ ctx, blobs, activeTenantId: () => 'tenant-1', upload: async (file, scope) => { scopes.push(scope.tenantId); return uploaded(file, scope); } });
    expect((await mine.drain()).uploaded).toHaveLength(1);
    expect(scopes).toEqual(['tenant-1']);
  });

  it('writes nothing when the workspace switches while the bytes are in flight', async () => {
    const { ctx, blobs, store, boardId } = await boardWithMedia();
    let active = 'tenant-1';
    const reported: string[] = [];
    const queue = createMediaUploadQueue({
      ctx, blobs, activeTenantId: () => active, report: (where) => { reported.push(where); },
      upload: async (file, scope) => { active = 'tenant-2'; return uploaded(file, scope); },
    });
    expect((await queue.drain()).uploaded).toEqual([]);
    expect((await statusOf(store, boardId)).status).not.toBe('uploaded');
    expect(reported).toContain('mediaUploadQueue.tenantSwitched');
  });

  it('does not start an upload when the workspace changed after the round began', async () => {
    const { ctx, blobs, store, boardId } = await boardWithMedia();
    let reads = 0;
    const upload = vi.fn(uploaded);
    // The first read selects the item, the second (the gate before the request) sees the switch.
    const queue = createMediaUploadQueue({ ctx, blobs, activeTenantId: () => (reads++ < 2 ? 'tenant-1' : 'tenant-2'), upload });
    await queue.drain();
    expect(upload).not.toHaveBeenCalled();
    expect(await statusOf(store, boardId)).toMatchObject({ status: 'local', attempts: 0 });
  });

  it('backs off a failed upload, lists it as retrying, and a person retry clears the wait', async () => {
    const { ctx: base, blobs, store, boardId, media } = await boardWithMedia();
    let clock = new Date(AT).getTime();
    const ctx = { ...base, now: () => new Date(clock) };
    const queue = createMediaUploadQueue({ ctx, blobs, activeTenantId: () => 'tenant-1', upload: async () => null, report: () => undefined });
    expect((await queue.drain()).retrying).toEqual([media.mediaId]);
    expect((await statusOf(store, boardId)).nextAttemptAt).toBe(new Date(clock + UPLOAD_BACKOFF_BASE_MS).toISOString());
    // Inside the wait the item is skipped, and it is listed for the person.
    expect(await queue.drain()).toEqual({ uploaded: [], retrying: [], failed: [] });
    expect(await listBoardMediaIssues(store, boardId, new Date(clock))).toEqual([{ id: media.mediaId, name: 'p.png', status: 'retrying', attempts: 1 }]);
    clock += UPLOAD_BACKOFF_BASE_MS;
    expect((await queue.drain()).retrying).toEqual([media.mediaId]);
  });

  it('lists a failed upload for retry, and a retry clears the wait', async () => {
    const { ctx: base, blobs, store, boardId, media } = await boardWithMedia();
    let clock = new Date(AT).getTime();
    const ctx = { ...base, now: () => new Date(clock) };
    const queue = createMediaUploadQueue({ ctx, blobs, activeTenantId: () => 'tenant-1', upload: async () => null, report: () => undefined, maxAttempts: 1 });
    expect((await queue.drain()).failed).toEqual([media.mediaId]);
    expect(await listBoardMediaIssues(store, boardId, new Date(clock))).toMatchObject([{ id: media.mediaId, status: 'failed' }]);
    await queue.retry(media.mediaId);
    expect((await statusOf(store, boardId)).nextAttemptAt).toBeUndefined();
  });

  it('doubles the wait per attempt up to a ceiling', () => {
    expect(uploadBackoffMs(1)).toBe(UPLOAD_BACKOFF_BASE_MS);
    expect(uploadBackoffMs(3)).toBe(UPLOAD_BACKOFF_BASE_MS * 4);
    expect(uploadBackoffMs(30)).toBe(UPLOAD_BACKOFF_MAX_MS);
  });
});
