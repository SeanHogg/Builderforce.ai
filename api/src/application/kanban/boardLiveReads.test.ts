import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readBoardLive: vi.fn(async (_e: unknown, _t: number, _p: number, _s: string, load: () => Promise<unknown>) => load()),
}));
vi.mock('../../infrastructure/cache/boardLiveCache', () => ({ readBoardLive: mocks.readBoardLive }));

import { readBoardLaneAgents, readBoardTicketOwners, readLaneAgents } from './boardLiveReads';

/** select() calls consume queued results; the final chain call is awaitable. */
function fakeDb(results: unknown[][]) {
  const selects = vi.fn();
  const mk = () => {
    const rows = results.shift() ?? [];
    const chain: Record<string, unknown> = {};
    for (const m of ['from', 'innerJoin', 'where']) chain[m] = () => chain;
    chain.limit = () => Promise.resolve(rows);
    chain.groupBy = () => Promise.resolve(rows);
    chain.orderBy = () => Promise.resolve(rows);
    return chain;
  };
  return { db: { select: () => { selects(); return mk(); } } as never, selects };
}

describe('board live reads', () => {
  beforeEach(() => mocks.readBoardLive.mockClear());

  it('caches ticket owners per board under the project token', async () => {
    const { db } = fakeDb([[{ projectId: 9 }], []]);
    const env = {} as never;
    await readBoardTicketOwners(db, env, 1, 'b1');
    expect(mocks.readBoardLive).toHaveBeenCalledWith(env, 1, 9, 'owners:b1', expect.any(Function));
  });

  it('excludes hosts already staffed on the lane from the owner read', async () => {
    const { db } = fakeDb([
      [{ projectId: 9 }],
      [{ laneId: 'l1', hostId: 5, name: 'A', ticketCount: 1 }, { laneId: 'l1', hostId: 6, name: 'B', ticketCount: 1 }],
      [{ assignment: { id: 'a', scopeId: 'l1', runtime: 'remote', target: '5' } }],
    ]);
    const out = await readBoardTicketOwners(db, undefined, 1, 'b1');
    expect(out).toEqual({ l1: [{ hostId: 6, name: 'B', ticketCount: 1, via: 'ticket' }] });
  });

  it('returns null (404) for a board outside the tenant and never reads', async () => {
    const { db } = fakeDb([[]]);
    expect(await readBoardLaneAgents(db, undefined, 1, 'nope')).toBeNull();
    expect(mocks.readBoardLive).not.toHaveBeenCalled();
  });

  it('loads every lane\'s agents in ONE query, grouped by lane', async () => {
    const { db, selects } = fakeDb([
      [{ projectId: 9 }],
      [
        { assignment: { id: 'a', scopeId: 'l1' } },
        { assignment: { id: 'b', scopeId: 'l1' } },
        { assignment: { id: 'c', scopeId: 'l2' } },
      ],
    ]);
    const out = await readBoardLaneAgents(db, undefined, 1, 'b1');
    expect(mocks.readBoardLive.mock.calls[0]?.[3]).toBe('lane-agents:b1');
    expect(selects).toHaveBeenCalledTimes(2); // board->project, then one lane-agents query
    expect(out).toEqual({
      l1: [{ id: 'a', scopeId: 'l1' }, { id: 'b', scopeId: 'l1' }],
      l2: [{ id: 'c', scopeId: 'l2' }],
    });
  });

  it('readLaneAgents returns one lane\'s rows from the board read, [] for an unstaffed lane, null for a foreign board', async () => {
    const rows = [{ assignment: { id: 'a', scopeId: 'l1' } }, { assignment: { id: 'c', scopeId: 'l2' } }];
    expect(await readLaneAgents(fakeDb([[{ projectId: 9 }], rows]).db, undefined, 1, 'b1', 'l1')).toEqual([{ id: 'a', scopeId: 'l1' }]);
    expect(await readLaneAgents(fakeDb([[{ projectId: 9 }], rows]).db, undefined, 1, 'b1', 'l9')).toEqual([]);
    expect(await readLaneAgents(fakeDb([[]]).db, undefined, 1, 'nope', 'l1')).toBeNull();
  });
});
