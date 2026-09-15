import { describe, expect, it, vi } from 'vitest';
import { projectInTenantCached } from './projectOwnership';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/**
 * {@link projectInTenantCached} — the read-through gate the Evermind console and
 * project-facts tier poll on every read. Only a `true` verdict may be cached (see
 * the doc comment on the function): a project never changes tenant, so a stale
 * `true` is harmless, but ids are serial, so a `false` today can be somebody's
 * project tomorrow and must never be served stale.
 */

interface FakeSelectChain {
  from(): FakeSelectChain;
  where(): FakeSelectChain;
  limit(): Promise<unknown[]>;
}

function fakeDb(rowsPerCall: unknown[][]) {
  let call = 0;
  const selectChain: FakeSelectChain = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => {
      const rows = rowsPerCall[call] ?? [];
      call += 1;
      return rows;
    },
  };
  const db = { select: () => selectChain } as unknown as Db;
  return { db, callCount: () => call };
}

function fakeEnv() {
  const env = { AUTH_CACHE_KV: { get: vi.fn(async () => null), put: vi.fn(), delete: vi.fn() } } as unknown as Env;
  return { env };
}

describe('projectInTenantCached', () => {
  it('caches a true answer — a second call never re-queries the db', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeDb([[{ id: 5 }]]);
    expect(await projectInTenantCached(env, db, 1, 5)).toBe(true);
    expect(await projectInTenantCached(env, db, 1, 5)).toBe(true);
    expect(callCount()).toBe(1);
  });

  it('does not cache a false answer — a not-found/other-tenant project re-queries every time', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeDb([[], []]);
    expect(await projectInTenantCached(env, db, 1, 999)).toBe(false);
    expect(await projectInTenantCached(env, db, 1, 999)).toBe(false);
    expect(callCount()).toBe(2);
  });

  it('rejects a non-integer id without touching the db', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeDb([[{ id: 1 }]]);
    expect(await projectInTenantCached(env, db, 1, 1.5)).toBe(false);
    expect(await projectInTenantCached(env, db, 1, -1)).toBe(false);
    expect(callCount()).toBe(0);
  });

  it('caches per (tenant, project) — a different tenant is a cache miss even for the same project id', async () => {
    const { env } = fakeEnv();
    const { db, callCount } = fakeDb([[{ id: 5 }], [{ id: 5 }]]);
    expect(await projectInTenantCached(env, db, 1, 5)).toBe(true);
    expect(await projectInTenantCached(env, db, 2, 5)).toBe(true);
    expect(callCount()).toBe(2);
  });
});
