// @vitest-environment jsdom
/** Design §9 item 6: a server-originated change lands in the store and the open board; unsent local edits are rebased. */
import { indexedDB } from 'fake-indexeddb';
import { createPlatformPolicy } from '@builderforce/local-first';
import { afterEach, describe, expect, it } from 'vitest';
import { createWebSyncDriver } from '@/lib/localFirst/webSyncDriver';
import { createWebSyncLease } from '@/lib/localFirst/webSyncLease';
import { commitBoardDiff, createBoard } from './boardCommit';
import { openBoard, reconcileBoard } from './boardOpen';
import { readBoard } from './boardReplica';
import type { ObjectPayload } from './boardRecords';
import { ACCOUNT, boardOf, createFakeBoardServer, openTestStore, sticky, testContext, uuid } from './boardTestkit';
import type { CanvasBoard } from '../../domain/canvasBoard';

const open: Array<{ close(): void }> = [];
afterEach(() => { for (const handle of open.splice(0)) handle.close(); });

const title = (board: CanvasBoard, id: string): unknown => board.nodes.find((node) => node.id === id)?.data.title;

async function syncedBoard() {
  const server = createFakeBoardServer();
  const store = openTestStore(indexedDB, `open-${uuid()}`);
  open.push(store);
  const ctx = testContext(store);
  const boardId = uuid();
  const [x, y] = [uuid(), uuid()];
  await createBoard(ctx, { boardId, destination: ACCOUNT, header: { title: 'Open' }, board: boardOf([sticky(x, 0, 'X'), sticky(y, 200, 'Y')]) });
  const driver = createWebSyncDriver({
    store, deviceId: 'device-a', destination: () => ACCOUNT, policy: createPlatformPolicy({ synchronize: true }),
    fetch: server.fetch, baseUrl: 'https://api.example', headers: {}, lease: createWebSyncLease({ deviceId: 'device-a', locks: null }),
    events: new EventTarget(), debounceMs: 0, report: () => undefined,
  });
  open.push({ close: () => driver.stop() });
  await driver.syncNow();
  const source = { read: async (id: string) => server.snapshot(id) };
  return { server, store, ctx, boardId, x, y, source, options: { store, destination: ACCOUNT, source, report: () => undefined } };
}

describe('open a board local first', () => {
  it('seeds a server board with no replica, writing no journal events', async () => {
    const { server, boardId, x, y, source } = await syncedBoard();
    const other = openTestStore(indexedDB, `open-${uuid()}`, 'device-b');
    open.push(other);
    const opened = await openBoard({ store: other, destination: ACCOUNT, source, report: () => undefined }, boardId);
    expect(opened.replica).toBeUndefined();
    const outcome = await opened.reconciled;
    expect(outcome.kind).toBe('seeded');
    const replica = (await readBoard(other, boardId))!;
    expect(replica.board.nodes.map((node) => node.id).sort()).toEqual([x, y].sort());
    expect(replica.serverRevision).toBe(server.revision(boardId));
    expect(await other.read((tx) => tx.pending())).toEqual([]);
    // A second open renders at once and finds nothing newer.
    const again = await openBoard({ store: other, destination: ACCOUNT, source, report: () => undefined }, boardId);
    expect(again.replica?.board.nodes).toHaveLength(2);
    expect((await again.reconciled).kind).toBe('current');
  });

  it('replaces the replica with a peer edit when nothing is unsent', async () => {
    const { server, store, options, boardId, y } = await syncedBoard();
    await (await openBoard(options, boardId)).reconciled;
    server.collaboratorEdit(boardId, y, { title: 'peer' });
    const outcome = await reconcileBoard(options, boardId, (await readBoard(store, boardId))!);
    expect(outcome.kind).toBe('replaced');
    expect(title((await readBoard(store, boardId))!.board, y)).toBe('peer');
  });

  it('rebases: unsent local edits stay, the peer edit and the peer card arrive, and the merge matches the store', async () => {
    const { server, store, ctx, options, boardId, x, y } = await syncedBoard();
    await (await openBoard(options, boardId)).reconciled;
    const before = (await readBoard(store, boardId))!;
    await commitBoardDiff(ctx, boardId, before.board, boardOf(before.board.nodes.map((node) => (node.id === x ? { ...node, data: { ...node.data, title: 'local' } } : node)), before.board.edges));
    const z = uuid();
    server.collaboratorEdit(boardId, y, { title: 'peer' });
    server.collaboratorAddObject(boardId, { id: z, boardId, kind: 'sticky', resourceType: null, resourceId: null, canvasData: { x: 5, y: 5 }, content: { kind: 'sticky', title: 'Z' } } satisfies ObjectPayload);

    const outcome = await reconcileBoard(options, boardId, (await readBoard(store, boardId))!);
    expect(outcome.kind).toBe('rebased');
    if (outcome.kind !== 'rebased') return;
    const fresh = (await readBoard(store, boardId))!.board;
    expect(title(fresh, x)).toBe('local');
    expect(title(fresh, y)).toBe('peer');
    expect(title(fresh, z)).toBe('Z');
    // The board-level rebase (`mergeCollaboratorBoards`, local last) names the same objects and values.
    expect(outcome.rebased!.nodes.map((node) => node.id).sort()).toEqual([x, y, z].sort());
    expect([title(outcome.rebased!, x), title(outcome.rebased!, y), title(outcome.rebased!, z)]).toEqual(['local', 'peer', 'Z']);
    // The local edit is still owed to the server.
    expect((await store.read((tx) => tx.pending())).some((event) => event.clientEntityId === x)).toBe(true);
  });

  it('keeps the replica and reports when the server cannot be read', async () => {
    const { store, boardId, x } = await syncedBoard();
    const reported: string[] = [];
    const offline = {
      store, destination: ACCOUNT, report: (where: string) => { reported.push(where); },
      source: { read: async () => { throw new TypeError('Failed to fetch'); } },
    };
    const opened = await openBoard(offline, boardId);
    expect(opened.replica?.board.nodes.map((node) => node.id)).toContain(x);
    const outcome = await opened.reconciled;
    expect(outcome.kind).toBe('offline');
    expect(reported).toEqual(['boardOpen.reconcile']);
    expect(await readBoard(store, boardId)).toBeDefined();
    // And with no network at all, the source is never asked.
    expect((await reconcileBoard({ ...offline, isOnline: () => false }, boardId)).kind).toBe('offline');
    expect(reported).toHaveLength(1);
  });
});
