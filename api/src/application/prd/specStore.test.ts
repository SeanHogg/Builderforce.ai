import { beforeEach, describe, expect, it, vi } from 'vitest';

const { linkSpecToTask, bumpTicketSearchVersion } = vi.hoisted(() => ({
  linkSpecToTask: vi.fn(async () => undefined),
  bumpTicketSearchVersion: vi.fn(async () => undefined),
}));

vi.mock('./taskPrd', () => ({ linkSpecToTask }));
vi.mock('./importSpec', () => ({ importSpecFromBoard: vi.fn() }));
vi.mock('../../infrastructure/cache/readThroughCache', () => ({ bumpTicketSearchVersion }));

import {
  attachSpecToTask, deleteSpec, getSpec, listTaskSpecs, patchSpec, upsertSpec,
} from './specStore';

const TENANT = 7;
const BUILDER = new Set([
  'select', 'from', 'innerJoin', 'where', 'orderBy', 'limit',
  'insert', 'values', 'onConflictDoUpdate', 'update', 'set', 'delete', 'returning',
]);

/**
 * A Drizzle-shaped fake: every builder method returns the chain, and awaiting
 * the chain yields the next queued result. Each statement consumes one result
 * in issue order, which is all these use-case tests need.
 */
function fakeDb(results: unknown[][]) {
  const calls: string[] = [];
  const queue = [...results];
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, prop) {
      // Only Drizzle builder names are callable, so matchers probing the fake
      // (asymmetricMatch, toJSON, symbols) see `undefined` like any plain object.
      if (typeof prop !== 'string' || !BUILDER.has(prop) && prop !== 'then') return undefined;
      if (prop === 'then') {
        const next = queue.shift() ?? [];
        return (resolve: (v: unknown) => void) => resolve(next);
      }
      return (..._args: unknown[]) => { calls.push(prop); return proxy; };
    },
  };
  const proxy = new Proxy(chain, handler);
  return { db: proxy as never, calls };
}

describe('specStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getSpec returns null when no tenant-scoped row matches', async () => {
    const { db } = fakeDb([[]]);
    expect(await getSpec(db, TENANT, 'nope')).toBeNull();
  });

  it('upsertSpec refuses an id owned by another tenant (no write, no link)', async () => {
    const { db, calls } = fakeDb([[{ tenantId: 999 }]]);
    const row = await upsertSpec(db, {} as never, { tenantId: TENANT, agentHostId: null }, { id: 'foreign', goal: 'x', taskId: 5 });
    expect(row).toBeNull();
    expect(calls).not.toContain('insert');
    expect(linkSpecToTask).not.toHaveBeenCalled();
    expect(bumpTicketSearchVersion).not.toHaveBeenCalled();
  });

  it('upsertSpec writes, links the in-tenant task as primary, bumps the typeahead and returns the row', async () => {
    const spec = { id: 's1', tenantId: TENANT, goal: 'Ship' };
    // insert → task lookup → final read
    const { db } = fakeDb([[], [{ id: 5 }], [spec]]);
    const row = await upsertSpec(db, {} as never, { tenantId: TENANT, agentHostId: 3 }, { goal: '  Ship  ', taskId: 5 });
    expect(row).toEqual(spec);
    // The fake db is a Proxy, so it is matched loosely rather than by equality.
    expect(linkSpecToTask).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: 5, tenantId: TENANT, isPrimary: true }));
    expect(bumpTicketSearchVersion).toHaveBeenCalledWith({}, TENANT);
  });

  it('patchSpec returns null for a spec outside the tenant', async () => {
    const { db } = fakeDb([[]]);
    expect(await patchSpec(db, TENANT, 's1', { goal: 'g' })).toBeNull();
  });

  it('deleteSpec reports whether a row went', async () => {
    expect(await deleteSpec(fakeDb([[{ id: 's1' }]]).db, TENANT, 's1')).toBe(true);
    expect(await deleteSpec(fakeDb([[]]).db, TENANT, 's1')).toBe(false);
  });

  it('attachSpecToTask refuses a spec the tenant does not own', async () => {
    const { db } = fakeDb([[]]);
    expect(await attachSpecToTask(db, { tenantId: TENANT, taskId: 5, specId: 'foreign' })).toBe(false);
    expect(linkSpecToTask).not.toHaveBeenCalled();
  });

  it('listTaskSpecs is the one task-filtered read (primary first)', async () => {
    const rows = [{ id: 's1', isPrimary: true }, { id: 's2', isPrimary: false }];
    const { db, calls } = fakeDb([rows]);
    expect(await listTaskSpecs(db, TENANT, 5)).toEqual(rows);
    expect(calls).toEqual(expect.arrayContaining(['select', 'from', 'innerJoin', 'where', 'orderBy', 'limit']));
  });
});
