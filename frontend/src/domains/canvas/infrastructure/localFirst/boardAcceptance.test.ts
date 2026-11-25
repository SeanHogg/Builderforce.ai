// @vitest-environment jsdom
/**
 * Studio local-first — design §9 items 1–3, at library level.
 *
 * Mirrors `lib/localFirst/deniedNetworkAcceptance.test.ts`: a real IndexedDB-backed store over
 * `fake-indexeddb`, an injected `fetch` (the server fake), and the one web sync driver. Nothing here
 * opens a socket or touches the page's `fetch`.
 */
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UNBOUND_DESTINATION, createPlatformPolicy, type EntityDestination } from '@builderforce/local-first';
import { createWebSyncDriver, type WebSyncDriverOptions } from '@/lib/localFirst/webSyncDriver';
import { createWebSyncLease } from '@/lib/localFirst/webSyncLease';
import { createBoard, commitBoardDiff } from './boardCommit';
import { attachBoardMedia } from './boardMedia';
import { readBoard } from './boardReplica';
import { createMediaUploadQueue } from './mediaUploadQueue';
import type { ObjectPayload } from './boardRecords';
import {
  ACCOUNT, AT, boardOf, createFakeBoardServer, link, openTestBlobs, openTestStore, sticky, testContext, uuid,
  type FakeBoardServer,
} from './boardTestkit';
import type { IndexedDbLocalFirstStore } from '@builderforce/local-first/indexed-db';

const png = (): Blob => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' });
const open: Array<{ close(): void }> = [];

function driverFor(store: IndexedDbLocalFirstStore, server: FakeBoardServer, extra: Partial<WebSyncDriverOptions> = {}) {
  const bus = new EventTarget();
  const reported: Array<[string, unknown]> = [];
  const driver = createWebSyncDriver({
    store,
    deviceId: 'device-a',
    destination: () => ACCOUNT,
    policy: createPlatformPolicy({ synchronize: true }),
    fetch: server.fetch,
    baseUrl: 'https://api.example',
    headers: { authorization: 'Bearer t' },
    lease: createWebSyncLease({ deviceId: 'device-a', locks: null }),
    events: bus,
    debounceMs: 0,
    report: (where, error) => { reported.push([where, error]); },
    ...extra,
  });
  open.push({ close: () => driver.stop() });
  return { driver, bus, reported };
}

async function seededBoard(destination: EntityDestination) {
  const db = `acceptance-${uuid()}`;
  const store = openTestStore(indexedDB, db);
  const blobs = openTestBlobs(indexedDB, `${db}-blobs`);
  open.push(store, blobs);
  const ctx = testContext(store);
  const boardId = uuid();
  const [a, b, c] = [uuid(), uuid(), uuid()];
  await createBoard(ctx, {
    boardId,
    destination,
    header: { title: 'Board' },
    board: boardOf([sticky(a, 0), sticky(b, 200), sticky(c, 400)], [link(uuid(), a, b)]),
    timeline: [{ clientMessageId: 'm1', role: 'user', body: 'hello', createdAt: AT }],
  });
  return { db, store, blobs, ctx, boardId, ids: { a, b, c } };
}

afterEach(() => {
  for (const handle of open.splice(0)) handle.close();
  vi.unstubAllGlobals();
});

describe('studio local-first acceptance (library level)', () => {
  it('1. a guest with no network creates, edits, adds an image and reloads: all present, zero fetch, no data URL', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { db, store, blobs, ctx, boardId } = await seededBoard(UNBOUND_DESTINATION);

    const photo = await attachBoardMedia(ctx, blobs, { boardId, file: png(), name: 'photo.png' });
    const before = (await readBoard(store, boardId))!;
    const image = { id: uuid(), type: 'creation' as const, position: { x: 0, y: 200 }, data: { kind: 'image' as const, title: 'Photo', url: photo.url } };
    await commitBoardDiff(ctx, boardId, before.board, boardOf([...before.board.nodes, image], before.board.edges));

    // A reload: a NEW store and blob store over the same databases.
    store.close();
    blobs.close();
    const reopened = openTestStore(indexedDB, db);
    const reblobs = openTestBlobs(indexedDB, `${db}-blobs`);
    open.push(reopened, reblobs);
    const replica = (await readBoard(reopened, boardId))!;

    expect(replica.board.nodes).toHaveLength(4);
    expect(replica.board.edges).toHaveLength(1);
    expect(replica.timeline.map((message) => message.body)).toEqual(['hello']);
    expect((replica.board.nodes.find((node) => node.id === image.id)!.data as { url: string }).url).toBe(photo.url);
    expect((await (await reblobs.get(photo.mediaId))!.arrayBuffer()).byteLength).toBe(4);
    expect(JSON.stringify(await reopened.export())).not.toContain('data:');
    // An unbound board owes the server nothing.
    expect(await reopened.read((tx) => tx.pending())).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('2. signed in and offline, then back online: the driver pushes, receipts map, the image uploads and its object follows', async () => {
    const server = createFakeBoardServer();
    server.offline = true;
    const { store, blobs, ctx, boardId } = await seededBoard(ACCOUNT);
    const photo = await attachBoardMedia(ctx, blobs, { boardId, file: png(), name: 'photo.png' });
    const before = (await readBoard(store, boardId))!;
    const image = { id: uuid(), type: 'creation' as const, position: { x: 0, y: 200 }, data: { kind: 'image' as const, title: 'Photo', url: photo.url } };
    await commitBoardDiff(ctx, boardId, before.board, boardOf([...before.board.nodes, image], before.board.edges));

    const { driver, bus } = driverFor(store, server);
    driver.start();
    await vi.waitFor(() => expect(driver.status().state).toBe('held'));
    // Board, three cards, an edge and the transcript message are owed; the image object waits on its bytes.
    expect(driver.status().pending).toBe(6);
    expect(server.pushes).toEqual([]);

    server.offline = false;
    bus.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(driver.status().pending).toBe(0));
    expect(server.revision(boardId)).toBe(6);
    expect(server.pushes[0]![0]!.entityType).toBe('canvas-board');
    const mapping = await store.read((tx) => tx.mapping('canvas-board', boardId, ACCOUNT));
    expect(mapping?.serverVersion).toBe(1);

    const queue = createMediaUploadQueue({
      ctx, blobs, canUpload: () => true,
      upload: async () => ({ url: 'https://files.example/k1', storageKey: 'tenant/private/media/k1' }),
    });
    expect((await queue.drain()).uploaded).toEqual([photo.mediaId]);
    await driver.syncNow();

    expect(driver.status().pending).toBe(0);
    // The manifest, then the object whose url was rewritten to the uploaded file.
    expect(server.revision(boardId)).toBe(8);
    const uploaded = server.entity('canvas-object', image.id)!.payload as ObjectPayload;
    expect(uploaded.content.url).toBe('https://files.example/k1');
    expect(uploaded.content.storageKey).toBe('tenant/private/media/k1');
    expect(server.entity('canvas-media', photo.mediaId)).toBeDefined();
  });

  it('3. a 503 holds the events (with Retry-After, and without), reports nothing, and the next success drains in order', async () => {
    const server = createFakeBoardServer();
    const { store, ctx, boardId, ids } = await seededBoard(ACCOUNT);
    let clock = Date.now();
    const { driver, reported } = driverFor(store, server, { now: () => clock });

    server.failWith = [{ status: 503, retryAfter: '120' }];
    let status = await driver.syncNow();
    expect(status.state).toBe('held');
    expect(status.pending).toBe(6);
    expect(Date.parse(status.nextAttemptAt!) - clock).toBe(120_000);
    // Inside the wait nothing is sent, and nothing is dead-lettered or reported.
    await driver.syncNow();
    expect(server.attempts).toBe(1);
    expect((await store.export()).events.filter((event) => event.deadLetter)).toEqual([]);
    expect(reported).toEqual([]);

    clock += 121_000;
    status = await driver.syncNow();
    expect(status.state).toBe('idle');
    expect(status.pending).toBe(0);
    expect(server.pushes.flat().map((event) => event.entityType)[0]).toBe('canvas-board');

    // Without a Retry-After the driver's own backoff paces the next try.
    const before = (await readBoard(store, boardId))!;
    await commitBoardDiff(ctx, boardId, before.board, boardOf(before.board.nodes.map((node) => (node.id === ids.a ? sticky(ids.a, 40, 'Moved') : node)), before.board.edges));
    server.failWith = [{ status: 503 }];
    status = await driver.syncNow();
    expect(status.state).toBe('held');
    expect(Date.parse(status.nextAttemptAt!) - clock).toBe(2_000);
    clock += 2_001;
    status = await driver.syncNow();
    expect(status.pending).toBe(0);
    expect((server.entity('canvas-object', ids.a)!.payload as ObjectPayload).content.title).toBe('Moved');
  });
});
