import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../env';
import type { Db } from '../database/connection';
import { hashSecret } from './HashService';
import { invalidateAgentHostKeyCache } from './keyResolutionCache';
import { verifyAgentHostKey } from './agentHostKeyLookup';
import { __clearL1CacheForTests } from '../cache/readThroughCache';

beforeEach(() => __clearL1CacheForTests());

/**
 * Host polls (heartbeat, cron, tool-audit batches) authenticate with the host key. The
 * key resolves BY HASH through the shared key cache, so a poll costs no database read
 * once warm, and the id in the route must still match the key's host.
 */

function fakeKv() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null)),
    put: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

function fakeDb(rows: Array<{ id: number; tenantId: number; status: string; tokenDailyLimit: number | null }>) {
  const where = vi.fn(() => ({ limit: async () => rows }));
  const db = { select: () => ({ from: () => ({ where }) }) } as unknown as Db;
  return { db, where };
}

const KEY = 'bfa_0123456789abcdef0123456789abcdef';

describe('verifyAgentHostKey', () => {
  it('accepts the key for its own host and reads the database once for repeated polls', async () => {
    const env = { AUTH_CACHE_KV: fakeKv() } as unknown as Env;
    const { db, where } = fakeDb([{ id: 5, tenantId: 9, status: 'active', tokenDailyLimit: null }]);

    expect(await verifyAgentHostKey(env, db, 5, KEY)).toEqual({ id: 5, tenantId: 9 });
    expect(await verifyAgentHostKey(env, db, 5, KEY)).toEqual({ id: 5, tenantId: 9 });
    expect(await verifyAgentHostKey(env, db, 5, KEY)).toEqual({ id: 5, tenantId: 9 });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("refuses a key presented for a different host's id", async () => {
    const env = { AUTH_CACHE_KV: fakeKv() } as unknown as Env;
    const { db } = fakeDb([{ id: 5, tenantId: 9, status: 'active', tokenDailyLimit: null }]);
    expect(await verifyAgentHostKey(env, db, 6, KEY)).toBeNull();
  });

  it('refuses a missing key, an unknown key and a non-active host', async () => {
    const env = { AUTH_CACHE_KV: fakeKv() } as unknown as Env;
    expect(await verifyAgentHostKey(env, fakeDb([]).db, 5, null)).toBeNull();
    expect(await verifyAgentHostKey(env, fakeDb([]).db, 5, KEY)).toBeNull();
    const suspended = fakeDb([{ id: 5, tenantId: 9, status: 'suspended', tokenDailyLimit: null }]);
    expect(await verifyAgentHostKey({ AUTH_CACHE_KV: fakeKv() } as unknown as Env, suspended.db, 5, KEY)).toBeNull();
  });

  it('a status change invalidates the cached verdict so the next poll re-reads', async () => {
    const env = { AUTH_CACHE_KV: fakeKv() } as unknown as Env;
    const active = fakeDb([{ id: 5, tenantId: 9, status: 'active', tokenDailyLimit: null }]);
    expect(await verifyAgentHostKey(env, active.db, 5, KEY)).not.toBeNull();

    await invalidateAgentHostKeyCache(env, await hashSecret(KEY));

    const suspended = fakeDb([{ id: 5, tenantId: 9, status: 'suspended', tokenDailyLimit: null }]);
    expect(await verifyAgentHostKey(env, suspended.db, 5, KEY)).toBeNull();
  });

  it('with the KV unbound it still verifies, falling through to the database', async () => {
    const { db, where } = fakeDb([{ id: 5, tenantId: 9, status: 'active', tokenDailyLimit: null }]);
    expect(await verifyAgentHostKey({} as Env, db, 5, KEY)).toEqual({ id: 5, tenantId: 9 });
    expect(where).toHaveBeenCalled();
  });

  it('caches a rejection for seconds, not the positive year', async () => {
    const kv = fakeKv();
    const env = { AUTH_CACHE_KV: kv } as unknown as Env;
    await verifyAgentHostKey(env, fakeDb([]).db, 5, KEY);
    const ttls = kv.put.mock.calls.map((c) => (c[2] as { expirationTtl?: number } | undefined)?.expirationTtl);
    expect(ttls.length).toBeGreaterThan(0);
    for (const ttl of ttls) expect(ttl).toBeLessThanOrEqual(60);

    const ok = fakeKv();
    await verifyAgentHostKey({ AUTH_CACHE_KV: ok } as unknown as Env,
      fakeDb([{ id: 5, tenantId: 9, status: 'active', tokenDailyLimit: null }]).db, 5, `${KEY}x`);
    expect((ok.put.mock.calls[0]![2] as { expirationTtl?: number }).expirationTtl).toBeGreaterThan(86_400);
  });
});
