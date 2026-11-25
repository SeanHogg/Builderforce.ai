// @vitest-environment jsdom
/**
 * Studio local-first — design §9 items 4 and 5: two tabs of one browser, and two devices on one server.
 */
import { indexedDB } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPlatformPolicy } from '@builderforce/local-first';
import type { LeaseLockManager } from '@builderforce/local-first/indexed-db';
import { createWebSyncDriver } from '@/lib/localFirst/webSyncDriver';
import { createWebSyncLease } from '@/lib/localFirst/webSyncLease';
import { captureBoardConflicts, listBoardConflicts, resolveBoardConflict } from './boardConflicts';
import { commitBoardDiff, createBoard } from './boardCommit';
import { openBoard } from './boardOpen';
import { readBoard } from './boardReplica';
import type { ObjectPayload } from './boardRecords';
import {
  ACCOUNT, boardOf, createFakeBoardServer, openTestStore, sticky, testContext, uuid, type FakeBoardServer,
} from './boardTestkit';
import type { IndexedDbLocalFirstStore } from '@builderforce/local-first/indexed-db';
import type { CanvasBoard } from '../../domain/canvasBoard';

const open: Array<{ close(): void }> = [];
afterEach(() => { for (const handle of open.splice(0)) handle.close(); });

const titleOf = (board: CanvasBoard, id: string): unknown => board.nodes.find((node) => node.id === id)?.data.title;
const retitle = (board: CanvasBoard, id: string, title: string): CanvasBoard =>
  boardOf(board.nodes.map((node) => (node.id === id ? { ...node, data: { ...node.data, title } } : node)), board.edges);

function syncOf(store: IndexedDbLocalFirstStore, server: FakeBoardServer, deviceId: string, locks: LeaseLockManager | null = null) {
  const driver = createWebSyncDriver({
    store, deviceId, destination: () => ACCOUNT,
    policy: createPlatformPolicy({ synchronize: true }),
    fetch: server.fetch, baseUrl: 'https://api.example', headers: { authorization: 'Bearer t' },
    lease: createWebSyncLease({ deviceId, locks }), events: new EventTarget(), debounceMs: 0, report: () => undefined,
  });
  open.push({ close: () => driver.stop() });
  return driver;
}

/** Two devices, one server: A creates and syncs a board of two cards; B opens it from the server. */
async function twoDevices() {
  const server = createFakeBoardServer();
  const dbA = openTestStore(indexedDB, `merge-a-${uuid()}`, 'device-a');
  const dbB = openTestStore(indexedDB, `merge-b-${uuid()}`, 'device-b');
  open.push(dbA, dbB);
  const a = testContext(dbA, 'device-a');
  const b = testContext(dbB, 'device-b');
  const boardId = uuid();
  const [x, y] = [uuid(), uuid()];
  await createBoard(a, { boardId, destination: ACCOUNT, header: { title: 'Shared' }, board: boardOf([sticky(x, 0, 'X'), sticky(y, 200, 'Y')]) });
  const syncA = syncOf(dbA, server, 'device-a');
  const syncB = syncOf(dbB, server, 'device-b');
  await syncA.syncNow();
  const source = { read: async (id: string) => server.snapshot(id) };
  const opened = await openBoard({ store: dbB, destination: ACCOUNT, source, report: () => undefined }, boardId);
  expect((await opened.reconciled).kind).toBe('seeded');
  return { server, dbA, dbB, a, b, boardId, x, y, syncA, syncB, source };
}

describe('two tabs of one browser (§9 item 4)', () => {
  it("shows tab A's edit in tab B without a reload, and merges edits to different cards", async () => {
    const name = `tabs-${uuid()}`;
    const tabA = openTestStore(indexedDB, name, 'device-a');
    const tabB = openTestStore(indexedDB, name, 'device-a');
    open.push(tabA, tabB);
    const ctxA = testContext(tabA);
    const ctxB = testContext(tabB);
    const boardId = uuid();
    const [x, y] = [uuid(), uuid()];
    await createBoard(ctxA, { boardId, destination: ACCOUNT, header: { title: 'Tabs' }, board: boardOf([sticky(x, 0, 'X'), sticky(y, 200, 'Y')]) });
    const seenByB = (await readBoard(tabB, boardId))!;
    expect(seenByB.board.nodes).toHaveLength(2);

    // Each tab edits a different card from the same starting point.
    const editedByA = await commitBoardDiff(ctxA, boardId, seenByB.board, retitle(seenByB.board, x, 'X by A'), { baseVersions: seenByB.versions });
    const editedByB = await commitBoardDiff(ctxB, boardId, seenByB.board, retitle(seenByB.board, y, 'Y by B'), { baseVersions: seenByB.versions });
    expect(editedByA.conflicts).toEqual([]);
    expect(editedByB.conflicts).toEqual([]);
    const merged = (await readBoard(tabA, boardId))!.board;
    expect(titleOf(merged, x)).toBe('X by A');
    expect(titleOf(merged, y)).toBe('Y by B');
  });

  it('keeps both values when two tabs edit the SAME card, as one conflict, and settles it', async () => {
    const name = `tabs-${uuid()}`;
    const tabA = openTestStore(indexedDB, name, 'device-a');
    const tabB = openTestStore(indexedDB, name, 'device-a');
    open.push(tabA, tabB);
    const ctxA = testContext(tabA);
    const ctxB = testContext(tabB);
    const boardId = uuid();
    const x = uuid();
    await createBoard(ctxA, { boardId, destination: ACCOUNT, header: { title: 'Tabs' }, board: boardOf([sticky(x, 0, 'X')]) });
    const start = (await readBoard(tabB, boardId))!;

    await commitBoardDiff(ctxA, boardId, start.board, retitle(start.board, x, 'from A'), { baseVersions: start.versions });
    const second = await commitBoardDiff(ctxB, boardId, start.board, retitle(start.board, x, 'from B'), { baseVersions: start.versions });

    expect(second.conflicts).toEqual([x]);
    // The stored value stays A's; B's proposal is kept beside it, retrievable.
    expect(titleOf((await readBoard(tabA, boardId))!.board, x)).toBe('from A');
    const conflicts = await listBoardConflicts(tabB, boardId);
    expect(conflicts).toHaveLength(1);
    expect((conflicts[0]!.local.payload as ObjectPayload).content.title).toBe('from B');
    expect((conflicts[0]!.remote.payload as ObjectPayload).content.title).toBe('from A');

    await resolveBoardConflict({ ...ctxB }, conflicts[0]!.id, 'mine');
    expect(titleOf((await readBoard(tabA, boardId))!.board, x)).toBe('from B');
    expect(await listBoardConflicts(tabB, boardId)).toEqual([]);
  });

  it('lets exactly one tab push: the second finds the sync lock taken and sends nothing', async () => {
    const server = createFakeBoardServer();
    const name = `pusher-${uuid()}`;
    const tabA = openTestStore(indexedDB, name, 'device-a');
    const tabB = openTestStore(indexedDB, name, 'device-a');
    open.push(tabA, tabB);
    const boardId = uuid();
    await createBoard(testContext(tabA), { boardId, destination: ACCOUNT, header: { title: 'One pusher' }, board: boardOf([sticky(uuid(), 0)]) });

    const held = new Set<string>();
    const locks: LeaseLockManager = {
      async request(lockName, _options, callback) {
        if (held.has(lockName)) return callback(null);
        held.add(lockName);
        try { return await callback({}); } finally { held.delete(lockName); }
      },
    };
    let release!: () => void;
    server.gate = new Promise<void>((resolve) => { release = resolve; });
    const syncA = syncOf(tabA, server, 'device-a', locks);
    const syncB = syncOf(tabB, server, 'device-a', locks);

    const first = syncA.syncNow();
    await vi.waitFor(() => expect(server.attempts).toBe(1));
    const second = await syncB.syncNow();
    expect(second.state).toBe('busy');
    release();
    await first;

    expect(server.maxInFlight).toBe(1);
    expect(server.pushes).toHaveLength(1);
    expect(server.revision(boardId)).toBe(2);
  });
});

describe('two devices on one server (§9 item 5)', () => {
  it('merges edits to different cards made on two devices', async () => {
    const { server, dbA, dbB, a, b, boardId, x, y, syncA, syncB, source } = await twoDevices();
    const atA = (await readBoard(dbA, boardId))!;
    const atB = (await readBoard(dbB, boardId))!;
    await commitBoardDiff(a, boardId, atA.board, retitle(atA.board, x, 'X on A'));
    await commitBoardDiff(b, boardId, atB.board, retitle(atB.board, y, 'Y on B'));
    await syncA.syncNow();
    await syncB.syncNow();
    expect(server.entity('canvas-object', x)!.version).toBe(2);
    expect(server.entity('canvas-object', y)!.version).toBe(2);
    expect((await syncB.syncNow()).pending).toBe(0);

    // Each device reconciles and ends on the same board.
    for (const store of [dbA, dbB]) {
      const outcome = await openBoard({ store, destination: ACCOUNT, source, report: () => undefined }, boardId);
      await outcome.reconciled;
      const board = (await readBoard(store, boardId))!.board;
      expect([titleOf(board, x), titleOf(board, y)]).toEqual(['X on A', 'Y on B']);
    }
  });

  it('records a conflict for the SAME card, keeps the local value, and resolves keep-theirs and keep-mine', async () => {
    for (const choice of ['theirs', 'mine'] as const) {
      const { server, dbB, a, b, boardId, x, syncA, syncB, dbA } = await twoDevices();
      const atA = (await readBoard(dbA, boardId))!;
      const atB = (await readBoard(dbB, boardId))!;
      await commitBoardDiff(a, boardId, atA.board, retitle(atA.board, x, 'from A'));
      await syncA.syncNow();
      await commitBoardDiff(b, boardId, atB.board, retitle(atB.board, x, 'from B'));
      const round = await syncB.syncNow();
      expect(round.lastSummary?.conflicts).toBe(1);
      // Held, not lost; and the local value is still what B renders.
      expect(round.pending).toBeGreaterThan(0);
      expect(titleOf((await readBoard(dbB, boardId))!.board, x)).toBe('from B');

      expect(await captureBoardConflicts(dbB, server.snapshot(boardId))).toBe(1);
      expect(await captureBoardConflicts(dbB, server.snapshot(boardId))).toBe(0);
      const [conflict] = await listBoardConflicts(dbB, boardId);
      expect((conflict!.local.payload as ObjectPayload).content.title).toBe('from B');
      expect((conflict!.remote.payload as ObjectPayload).content.title).toBe('from A');

      await resolveBoardConflict(b, conflict!.id, choice);
      expect(await listBoardConflicts(dbB, boardId)).toEqual([]);
      await syncB.syncNow();
      if (choice === 'theirs') {
        expect(titleOf((await readBoard(dbB, boardId))!.board, x)).toBe('from A');
        expect((server.entity('canvas-object', x)!.payload as ObjectPayload).content.title).toBe('from A');
      } else {
        expect((server.entity('canvas-object', x)!.payload as ObjectPayload).content.title).toBe('from B');
      }
      expect((await syncB.syncNow()).pending).toBe(0);
    }
  });

  it('delete wins over an edit; the edit is kept and can be restored as a copy', async () => {
    const { server, dbA, dbB, a, b, boardId, x, syncA, syncB } = await twoDevices();
    const atA = (await readBoard(dbA, boardId))!;
    const atB = (await readBoard(dbB, boardId))!;
    await commitBoardDiff(a, boardId, atA.board, boardOf(atA.board.nodes.filter((node) => node.id !== x), atA.board.edges));
    await syncA.syncNow();
    expect(server.entity('canvas-object', x)!.deleted).toBe(true);

    await commitBoardDiff(b, boardId, atB.board, retitle(atB.board, x, 'edited on B'));
    await syncB.syncNow();
    await captureBoardConflicts(dbB, server.snapshot(boardId));
    const [conflict] = await listBoardConflicts(dbB, boardId);
    expect(conflict!.reason).toBe('edit_vs_remote_delete');

    const copyId = uuid();
    await resolveBoardConflict({ ...b, newId: () => copyId }, conflict!.id, 'restore-copy');
    await syncB.syncNow();
    expect(server.entity('canvas-object', x)!.deleted).toBe(true);
    expect((server.entity('canvas-object', copyId)!.payload as ObjectPayload).content.title).toBe('edited on B');
    const board = (await readBoard(dbB, boardId))!.board;
    expect(board.nodes.map((node) => node.id)).toContain(copyId);
    expect(board.nodes.map((node) => node.id)).not.toContain(x);
  });
});
