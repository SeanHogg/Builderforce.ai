// @vitest-environment jsdom
/** Design §9 item 8: binding a guest board to an account is one transaction, in dependency order, and idempotent. */
import { indexedDB } from 'fake-indexeddb';
import { UNBOUND_DESTINATION, createPlatformPolicy, type EntityDestination } from '@builderforce/local-first';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebSyncDriver } from '@/lib/localFirst/webSyncDriver';
import { createWebSyncLease } from '@/lib/localFirst/webSyncLease';
import { bindBoardToAccount } from './boardBind';
import { commitBoardDiff, createBoard } from './boardCommit';
import { attachBoardMedia } from './boardMedia';
import { readBoard } from './boardReplica';
import {
  ACCOUNT, AT, boardOf, createFakeBoardServer, link, openTestBlobs, openTestStore, sticky, testContext, uuid,
} from './boardTestkit';

const open: Array<{ close(): void }> = [];
afterEach(() => { for (const handle of open.splice(0)) handle.close(); });

async function guestBoard() {
  const db = `bind-${uuid()}`;
  const store = openTestStore(indexedDB, db);
  const blobs = openTestBlobs(indexedDB, `${db}-blobs`);
  open.push(store, blobs);
  const ctx = testContext(store);
  const boardId = uuid();
  const [a, b] = [uuid(), uuid()];
  await createBoard(ctx, {
    boardId, destination: UNBOUND_DESTINATION, header: { title: 'Guest' },
    board: boardOf([sticky(a, 0), sticky(b, 200)], [link(uuid(), a, b)]),
    timeline: [{ clientMessageId: 'm1', role: 'user', body: 'hi', createdAt: AT }],
  });
  // A guest edit and an image, both unjournaled.
  const photo = await attachBoardMedia(ctx, blobs, { boardId, file: new Blob([new Uint8Array([1, 2])], { type: 'image/png' }), name: 'p.png' });
  const before = (await readBoard(store, boardId))!;
  const image = { id: uuid(), type: 'creation' as const, position: { x: 0, y: 200 }, data: { kind: 'image' as const, title: 'P', url: photo.url } };
  await commitBoardDiff(ctx, boardId, before.board, boardOf([...before.board.nodes, image], before.board.edges));
  return { store, ctx, boardId, image, photo };
}

describe('bind a guest board to an account', () => {
  it('rebinds the board and every child in one transaction and enqueues board first, children after', async () => {
    const { store, ctx, boardId, image } = await guestBoard();
    expect(await store.read((tx) => tx.pending())).toEqual([]);

    const outcome = await bindBoardToAccount(ctx, boardId, ACCOUNT);
    expect(outcome.status).toBe('bound');

    const pending = await store.read((tx) => tx.pending());
    // Board, two cards, an edge, the transcript message. The image object and its local media wait for the upload.
    expect(pending.map((event) => event.entityType)[0]).toBe('canvas-board');
    expect(pending).toHaveLength(5);
    expect(pending.some((event) => event.clientEntityId === image.id)).toBe(false);
    const boardEvent = pending[0]!;
    for (const child of pending.slice(1)) {
      expect(child.dependsOn.some((id) => id === boardEvent.eventId || id === boardEvent.idempotencyKey)).toBe(true);
      expect(child.destination).toEqual(ACCOUNT);
    }
    const replica = (await readBoard(store, boardId))!;
    expect(replica.destination).toEqual(ACCOUNT);
    expect(replica.media.every((media) => media.destination.kind === 'bound')).toBe(true);
  });

  it('a second bind is a no-op, and a different account is refused', async () => {
    const { store, ctx, boardId } = await guestBoard();
    await bindBoardToAccount(ctx, boardId, ACCOUNT);
    const count = (await store.read((tx) => tx.pending())).length;

    expect((await bindBoardToAccount(ctx, boardId, ACCOUNT)).status).toBe('already-bound');
    expect((await store.read((tx) => tx.pending())).length).toBe(count);
    await expect(bindBoardToAccount(ctx, boardId, { ...ACCOUNT, tenantId: 'tenant-2' } as EntityDestination)).rejects.toMatchObject({ code: 'cross_destination' });
    expect((await bindBoardToAccount(ctx, uuid(), ACCOUNT)).status).toBe('missing');
  });

  it('refuses a missing or forged destination', async () => {
    const { ctx, boardId } = await guestBoard();
    await expect(bindBoardToAccount(ctx, boardId, { kind: 'bound' })).rejects.toMatchObject({ code: 'destination_required' });
    await expect(bindBoardToAccount(ctx, boardId, UNBOUND_DESTINATION)).rejects.toMatchObject({ code: 'destination_required' });
  });

  it('pushes in dependency order and the server holds nothing pending', async () => {
    const { store, ctx, boardId } = await guestBoard();
    await bindBoardToAccount(ctx, boardId, ACCOUNT);
    const server = createFakeBoardServer();
    const driver = createWebSyncDriver({
      store, deviceId: 'device-a', destination: () => ACCOUNT, policy: createPlatformPolicy({ synchronize: true }),
      fetch: server.fetch, baseUrl: 'https://api.example', headers: {}, lease: createWebSyncLease({ deviceId: 'device-a', locks: null }),
      events: new EventTarget(), debounceMs: 0, report: () => undefined,
    });
    open.push({ close: () => driver.stop() });
    const status = await driver.syncNow();
    expect(status.pending).toBe(0);
    expect(server.revision(boardId)).toBe(5);
    expect(server.pushes.flat()[0]!.entityType).toBe('canvas-board');
  });

  it('keeps the board, held not lost, when the server refuses it for the plan', async () => {
    const { store, ctx, boardId } = await guestBoard();
    await bindBoardToAccount(ctx, boardId, ACCOUNT);
    const driver = createWebSyncDriver({
      store, deviceId: 'device-a', destination: () => ACCOUNT, policy: createPlatformPolicy({ synchronize: true }),
      fetch: async (_url, init) => {
        const { events } = JSON.parse(init.body) as { events: Array<{ eventId: string }> };
        const receipts = events.map((event) => ({ eventId: event.eventId, status: 'rejected', receivedAt: AT, detail: 'canvas_plan_limit' }));
        return { ok: true, status: 200, json: async () => ({ receipts }), headers: { get: () => null } };
      },
      baseUrl: 'https://api.example', headers: {}, lease: createWebSyncLease({ deviceId: 'device-a', locks: null }),
      events: new EventTarget(), debounceMs: 0, report: () => undefined,
    });
    open.push({ close: () => driver.stop() });
    const status = await driver.syncNow();
    expect(status.lastSummary?.rejected).toBeGreaterThan(0);
    expect(status.pending).toBeGreaterThan(0);
    const events = (await store.export()).events;
    expect(events.every((event) => !event.deadLetter)).toBe(true);
    expect(events.some((event) => event.holdKind === 'rejected')).toBe(true);
    expect(await readBoard(store, boardId)).toBeDefined();
  });
});
