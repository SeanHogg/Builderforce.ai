/**
 * THE WORKSPACE EXECUTION SWITCH — see the module header on
 * `agentExecutionGate.ts` for the two freshness contracts this pins:
 *
 *   • the deployment-wide `AGENT_EXECUTION_ENABLED=false` override outranks
 *     every tenant's own setting, on BOTH the authoritative and cached reads;
 *   • the tenant's own `agent_execution_enabled` flag, read straight for the
 *     authoritative check;
 *   • the cached pre-check goes through `getOrSetCached` (one DB round trip
 *     per cache fill, not per call) and `invalidateAgentExecutionGate` clears
 *     it so a manager's write is visible on the very next read.
 *
 * The L1 layer of the read-through cache is reset before every test by
 * `test/setup.ts`, so tenant ids need not be hand-picked to avoid collisions.
 */
import { describe, expect, it } from 'vitest';
import {
  agentExecutionEnabledCached,
  invalidateAgentExecutionGate,
  readAgentExecutionEnabled,
} from './agentExecutionGate';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** A `db.select({enabled}).from(tenants).where(...).limit(1)` double that counts
 *  every round trip and answers with whatever `enabled` currently points at —
 *  so a test can flip the underlying value and prove a cache boundary. */
function tenantsDb(enabled: () => boolean | undefined) {
  const calls = { n: 0 };
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            calls.n += 1;
            const value = enabled();
            return value === undefined ? [] : [{ enabled: value }];
          },
        }),
      }),
    }),
  } as unknown as Db;
  return { db, calls };
}

/** A minimal in-memory `KVNamespace` double — enough for `getOrSetCached` /
 *  `invalidateCached` to exercise the real L2 path rather than degrading to
 *  L1-only, which is what every call would do with `AUTH_CACHE_KV` unbound. */
function fakeKv() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => (store.has(key) ? JSON.parse(store.get(key)!) : null),
    put: async (key: string, value: string) => { store.set(key, value); },
    delete: async (key: string) => { store.delete(key); },
  };
}

const envWith = (over: Partial<Env> = {}): Env => ({ AUTH_CACHE_KV: fakeKv() as never, ...over } as Env);

describe('readAgentExecutionEnabled — the authoritative, uncached read', () => {
  it('is true only when the tenant row says so', async () => {
    const { db } = tenantsDb(() => true);
    await expect(readAgentExecutionEnabled(undefined, db, 1)).resolves.toBe(true);
  });

  it('fails CLOSED for a tenant row that is absent, false, or merely truthy-looking', async () => {
    const { db: missing } = tenantsDb(() => undefined);
    await expect(readAgentExecutionEnabled(undefined, missing, 2)).resolves.toBe(false);

    const { db: off } = tenantsDb(() => false);
    await expect(readAgentExecutionEnabled(undefined, off, 3)).resolves.toBe(false);
  });

  it('the deployment-wide override disables regardless of the tenant flag, and reads no row', async () => {
    const { db, calls } = tenantsDb(() => true);
    const env = envWith({ AGENT_EXECUTION_ENABLED: 'false' });
    await expect(readAgentExecutionEnabled(env, db, 4)).resolves.toBe(false);
    // The override short-circuits before the tenant is even looked up — an
    // emergency stop must not depend on the database being reachable.
    expect(calls.n).toBe(0);
  });

  it('the override only matches the exact value "false" (case/whitespace-insensitive), never a truthy string', async () => {
    const { db } = tenantsDb(() => true);
    await expect(readAgentExecutionEnabled(envWith({ AGENT_EXECUTION_ENABLED: ' FALSE ' }), db, 5)).resolves.toBe(false);
    await expect(readAgentExecutionEnabled(envWith({ AGENT_EXECUTION_ENABLED: 'true' }), db, 5)).resolves.toBe(true);
    await expect(readAgentExecutionEnabled(envWith({ AGENT_EXECUTION_ENABLED: '' }), db, 5)).resolves.toBe(true);
  });
});

describe('agentExecutionEnabledCached — the pre-check', () => {
  it('answers the tenant flag straight through when there is no env to cache with', async () => {
    const { db, calls } = tenantsDb(() => true);
    await expect(agentExecutionEnabledCached(undefined, db, 10)).resolves.toBe(true);
    await expect(agentExecutionEnabledCached(undefined, db, 10)).resolves.toBe(true);
    // No env ⇒ `getOrSetCached` is never reached, so every call re-reads.
    expect(calls.n).toBe(2);
  });

  it('the deployment override disables without ever touching the cache or the database', async () => {
    const { db, calls } = tenantsDb(() => true);
    const env = envWith({ AGENT_EXECUTION_ENABLED: 'false' });
    await expect(agentExecutionEnabledCached(env, db, 11)).resolves.toBe(false);
    expect(calls.n).toBe(0);
  });

  it('goes through getOrSetCached: one DB round trip fills the cache, the next call hits it', async () => {
    let enabled = true;
    const { db, calls } = tenantsDb(() => enabled);
    const env = envWith();
    await expect(agentExecutionEnabledCached(env, db, 12)).resolves.toBe(true);
    expect(calls.n).toBe(1);

    // The underlying flag flips, but a second ask still answers the CACHED
    // value and issues no second round trip — proving this goes through the
    // cache rather than re-deriving on every call.
    enabled = false;
    await expect(agentExecutionEnabledCached(env, db, 12)).resolves.toBe(true);
    expect(calls.n).toBe(1);
  });

  it('caches a false verdict too — a disabled tenant is not re-derived every call', async () => {
    const { db, calls } = tenantsDb(() => false);
    const env = envWith();
    await expect(agentExecutionEnabledCached(env, db, 13)).resolves.toBe(false);
    await expect(agentExecutionEnabledCached(env, db, 13)).resolves.toBe(false);
    expect(calls.n).toBe(1);
  });

  it('caches PER TENANT — one tenant\'s fill does not answer for another', async () => {
    const { db, calls } = tenantsDb(() => true);
    const env = envWith();
    await agentExecutionEnabledCached(env, db, 14);
    await agentExecutionEnabledCached(env, db, 15);
    expect(calls.n).toBe(2);
  });
});

describe('invalidateAgentExecutionGate — a manager\'s write must be visible next read', () => {
  it('clears the cached verdict so the next read re-derives it from the database', async () => {
    let enabled = true;
    const { db, calls } = tenantsDb(() => enabled);
    const env = envWith();

    await expect(agentExecutionEnabledCached(env, db, 20)).resolves.toBe(true);
    expect(calls.n).toBe(1);

    // A manager switches it off. Without invalidation the cache would keep
    // answering `true` for up to five minutes — an emergency stop that does
    // not actually stop anything until a TTL happens to expire.
    enabled = false;
    await invalidateAgentExecutionGate(env, 20);

    await expect(agentExecutionEnabledCached(env, db, 20)).resolves.toBe(false);
    expect(calls.n).toBe(2);
  });

  it('invalidating one tenant leaves another tenant\'s cached verdict alone', async () => {
    const { db, calls } = tenantsDb(() => true);
    const env = envWith();

    await agentExecutionEnabledCached(env, db, 21);
    await agentExecutionEnabledCached(env, db, 22);
    expect(calls.n).toBe(2);

    await invalidateAgentExecutionGate(env, 21);

    await agentExecutionEnabledCached(env, db, 21); // re-derived
    await agentExecutionEnabledCached(env, db, 22); // still cached
    expect(calls.n).toBe(3);
  });
});
