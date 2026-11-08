import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';

// A tiny in-memory read-through cache: getOrSetCached runs the loader on a miss and remembers it; invalidateCached drops the entry.
const store = new Map<string, unknown>();
vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  getOrSetCached: vi.fn(async (_env: unknown, key: string, loader: () => Promise<unknown>) => {
    if (store.has(key)) return store.get(key);
    const value = await loader();
    store.set(key, value);
    return value;
  }),
  invalidateCached: vi.fn(async (_env: unknown, key: string) => { store.delete(key); }),
}));

const findCanonicalBoard = vi.fn();
vi.mock('./canonicalBoard', () => ({ findCanonicalBoard: (...a: unknown[]) => findCanonicalBoard(...a) }));
vi.mock('../../infrastructure/database/tenantScope', () => ({ scopedToTenant: () => undefined }));
vi.mock('./laneAgentAssignments', () => ({
  forLanes: () => undefined,
  laneAgentAssignments: { scopeId: 'scopeId', runtime: 'runtime' },
}));

import { invalidateLaneRouting, readLaneRouting } from './laneRouting';

const env = {} as Env;

const LANES = [
  { id: 'l1', key: 'todo', gate: null, isTerminal: false, successPolicy: 'all', successThreshold: null, actionType: null, executionMode: 'auto' },
  { id: 'l2', key: 'done', gate: 'review', isTerminal: true, successPolicy: 'all', successThreshold: null, actionType: null, executionMode: 'manual' },
];
const STAFFED = [
  { laneId: 'l1', runtime: 'cloud' },
  { laneId: 'l1', runtime: null },
];

/** db mock: the first `.select().from().where()` answers the lanes read, the second the staffing read. */
function makeDb() {
  const answers = [LANES, STAFFED];
  const select = vi.fn(() => ({ from: () => ({ where: async () => answers.shift() ?? [] }) }));
  return { db: { select } as never, select };
}

describe('readLaneRouting', () => {
  beforeEach(() => {
    store.clear();
    findCanonicalBoard.mockReset();
    findCanonicalBoard.mockResolvedValue({ id: 'board-1', lifecycleManaged: true });
  });

  it('returns the canonical board, its lanes and the runtimes staffed on each lane', async () => {
    const { db } = makeDb();
    const routing = await readLaneRouting(env, db, 7, 42);

    expect(routing).not.toBeNull();
    expect(routing!.tenantId).toBe(7);
    expect(routing!.boardId).toBe('board-1');
    expect(routing!.lifecycleManaged).toBe(true);
    expect(routing!.lanes.map((l) => l.id)).toEqual(['l1', 'l2']);
    expect(routing!.lanes[0]).toMatchObject({ key: 'todo', gate: null, isTerminal: false, runtimes: ['cloud', null] });
    expect(routing!.lanes[1]).toMatchObject({ key: 'done', gate: 'review', isTerminal: true, runtimes: [] });
  });

  it('returns null when the project has no canonical board', async () => {
    findCanonicalBoard.mockResolvedValue(null);
    const { db, select } = makeDb();
    expect(await readLaneRouting(env, db, 7, 42)).toBeNull();
    expect(select).not.toHaveBeenCalled();
  });

  it("keys the entry by tenant, so another tenant's read never sees it", async () => {
    const { db } = makeDb();
    await readLaneRouting(env, db, 7, 42); // tenant 7 populates its own entry
    expect(store.has('lane-routing:8:42')).toBe(false);
    const other = await readLaneRouting(env, makeDb().db, 8, 42);
    expect(other!.tenantId).toBe(8);
    expect(store.has('lane-routing:8:42')).toBe(true);
  });

  it('serves the second read from the cache', async () => {
    const { db, select } = makeDb();
    await readLaneRouting(env, db, 7, 42);
    await readLaneRouting(env, db, 7, 42);
    expect(select).toHaveBeenCalledTimes(2); // lanes + staffing once, none on the hit
    expect(findCanonicalBoard).toHaveBeenCalledTimes(1);
  });
});

describe('invalidateLaneRouting', () => {
  beforeEach(() => {
    store.clear();
    findCanonicalBoard.mockReset();
    findCanonicalBoard.mockResolvedValue({ id: 'board-1' });
  });

  it('drops the entry so the next read reloads', async () => {
    const { db } = makeDb();
    await readLaneRouting(env, db, 7, 42);
    expect(store.has('lane-routing:7:42')).toBe(true);

    await invalidateLaneRouting(env, 7, 42);
    expect(store.has('lane-routing:7:42')).toBe(false);

    await readLaneRouting(env, makeDb().db, 7, 42);
    expect(findCanonicalBoard).toHaveBeenCalledTimes(2);
  });

  it('leaves other projects cached', async () => {
    await readLaneRouting(env, makeDb().db, 7, 42);
    await readLaneRouting(env, makeDb().db, 7, 43);
    await invalidateLaneRouting(env, 7, 42);
    expect(store.has('lane-routing:7:43')).toBe(true);
  });
});
