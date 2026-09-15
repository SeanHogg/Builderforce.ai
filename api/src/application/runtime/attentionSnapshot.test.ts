import { describe, expect, it, vi } from 'vitest';
import { bumpAttention, readAttention } from './attentionSnapshot';
import { approvals, executions, projectManagerConfigs } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * {@link readAttention} — the cached cross-surface "what's live / what needs me"
 * snapshot every open VS Code window and web tab polls. These tests exercise the
 * caching contract described on the module: a version-token cache keyed per
 * tenant, `fresh` bypassing and re-priming it, {@link bumpAttention} orphaning it,
 * and `recentlyActive` being derived from the clock at READ time rather than
 * baked into the cached payload.
 */

/** A `Db` double keyed by TABLE IDENTITY rather than call order: `.from(table)`
 *  picks which row-set a query resolves to, so the fake works regardless of how
 *  many builder calls (`.innerJoin`, `.where`, `.orderBy`, `.limit`) chain onto it
 *  — `loadAttention` ends some queries at `.where()` and others at `.limit()`. */
function fakeDb(rowsByTable: Map<unknown, unknown[]>) {
  const fromCalls = new Map<unknown, number>();

  function makeChain() {
    let getRows = (): unknown[] => [];
    const chain = {
      from(table: unknown) {
        fromCalls.set(table, (fromCalls.get(table) ?? 0) + 1);
        getRows = () => rowsByTable.get(table) ?? [];
        return chain;
      },
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
        Promise.resolve(getRows()).then(resolve, reject),
    };
    return chain;
  }

  const db = { select: () => makeChain() } as unknown as Db;
  return { db, callsFor: (table: unknown) => fromCalls.get(table) ?? 0 };
}

/**
 * A REAL (Map-backed) fake KV, not just an L1-relying stub: the `recentlyActive`
 * test below advances the clock past the snapshot's 15s L1 TTL (to clear the
 * 3-minute manager-active window), so only an actually-persisting L2 layer keeps
 * the read from silently falling through to a genuine reload at that point.
 */
function fakeEnv() {
  const store = new Map<string, string>();
  const kv = {
    get: vi.fn(async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null)),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
  const env = { AUTH_CACHE_KV: kv } as unknown as Env;
  return { env };
}

const EMPTY_ROWS = new Map<unknown, unknown[]>([
  [executions, []],
  [approvals, []],
  [projectManagerConfigs, []],
]);

describe('readAttention', () => {
  it('serves a second read from cache without re-loading', async () => {
    const { env } = fakeEnv();
    const { db, callsFor } = fakeDb(EMPTY_ROWS);

    const first = await readAttention(env, db, { tenantId: 1 });
    expect(first.counts).toEqual({ running: 0, awaiting: 0, unread: 0 });
    expect(callsFor(executions)).toBe(1);

    const second = await readAttention(env, db, { tenantId: 1 });
    expect(second).toEqual(first);
    expect(callsFor(executions)).toBe(1); // loader did not run again
  });

  it('fresh bypasses the cache and re-primes it for the next plain read', async () => {
    const { env } = fakeEnv();
    const { db, callsFor } = fakeDb(EMPTY_ROWS);

    await readAttention(env, db, { tenantId: 1 });
    expect(callsFor(executions)).toBe(1);

    await readAttention(env, db, { tenantId: 1, fresh: true });
    expect(callsFor(executions)).toBe(2); // fresh always reloads

    await readAttention(env, db, { tenantId: 1 });
    expect(callsFor(executions)).toBe(2); // now served from the re-primed cache
  });

  it('bumpAttention orphans the cached snapshot so the next read reloads (a new version)', async () => {
    const { env } = fakeEnv();
    const { db, callsFor } = fakeDb(EMPTY_ROWS);

    await readAttention(env, db, { tenantId: 1 });
    expect(callsFor(executions)).toBe(1);

    await bumpAttention(env, 1);

    await readAttention(env, db, { tenantId: 1 });
    expect(callsFor(executions)).toBe(2);
  });

  it('does not orphan a DIFFERENT tenant\'s cached snapshot', async () => {
    const { env } = fakeEnv();
    const { db, callsFor } = fakeDb(EMPTY_ROWS);

    await readAttention(env, db, { tenantId: 1 });
    await bumpAttention(env, 2); // a different tenant
    await readAttention(env, db, { tenantId: 1 });
    expect(callsFor(executions)).toBe(1); // tenant 1's snapshot is untouched
  });

  it('derives recentlyActive from the clock at READ time, not from the cached payload', async () => {
    vi.useFakeTimers();
    try {
      const { env } = fakeEnv();
      const startedAt = Date.now();
      const rows = new Map<unknown, unknown[]>([
        [executions, []],
        [approvals, []],
        [projectManagerConfigs, [{ lastRunAt: new Date(startedAt) }]],
      ]);
      const { db, callsFor } = fakeDb(rows);

      const first = await readAttention(env, db, { tenantId: 1 });
      expect(first.manager.recentlyActive).toBe(true);

      // Past the 3-minute manager-active window, but still within the snapshot's
      // own cache TTL — this read must still hit the cache (same loader output)
      // yet report recentlyActive: false, because it is computed at read time.
      vi.setSystemTime(startedAt + 4 * 60_000);
      const second = await readAttention(env, db, { tenantId: 1 });
      expect(callsFor(executions)).toBe(1); // still served from cache
      expect(second.manager.recentlyActive).toBe(false);
      expect(second.manager.lastRunAt).toBe(first.manager.lastRunAt);
    } finally {
      vi.useRealTimers();
    }
  });
});
