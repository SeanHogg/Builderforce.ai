import { beforeEach, describe, expect, it } from 'vitest';
import { flushCounterBuffer, resetCounterBufferForTests } from '../../infrastructure/cache/counterBuffer';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { applyHitDeltas, flushHitCounters, recordHit, scopedHitKey } from './hitCounters';

function kvStub() {
  const store = new Map<string, { v: string; metadata: unknown }>();
  const kv = {
    get: async (k: string) => store.get(k)?.v ?? null,
    put: async (k: string, v: string, o?: { metadata?: unknown }) => { store.set(k, { v, metadata: o?.metadata }); },
    delete: async (k: string) => { store.delete(k); },
    list: async ({ prefix, limit = 1000 }: { prefix: string; limit?: number }) => {
      const all = [...store.entries()].filter(([k]) => k.startsWith(prefix));
      return { keys: all.slice(0, limit).map(([name, e]) => ({ name, metadata: e.metadata })), list_complete: all.length <= limit };
    },
  } as unknown as KVNamespace;
  return { env: { AUTH_CACHE_KV: kv } as Env, store };
}

function dbStub() {
  const statements: string[] = [];
  const db = { execute: async (q: SQL) => { statements.push(new PgDialect().sqlToQuery(q).sql); return {}; } } as unknown as Db;
  return { db, statements };
}

describe('hit counters', () => {
  beforeEach(() => resetCounterBufferForTests());

  it('buffers hits in KV without touching the database', async () => {
    const { env, store } = kvStub();
    const { db, statements } = dbStub();
    await recordHit(env, db, 'skill.download', 'my-skill');
    await recordHit(env, db, 'skill.download', 'my-skill');
    await flushCounterBuffer(env);
    expect(statements).toHaveLength(0);
    // First hit flushed at once; the second rides the next flush — each written once to its own key.
    expect([...store.values()].map((e) => (e.metadata as { n: number }).n).sort()).toEqual([1, 1]);
    expect(new Set(store.keys()).size).toBe(2);
  });

  it('applies directly when there is no KV, so a hit is never dropped', async () => {
    const { db, statements } = dbStub();
    await recordHit({}, db, 'landing.view', scopedHitKey(3, 9));
    expect(statements).toHaveLength(1);
  });

  it('the sweep applies ONE statement per kind and empties the buffer', async () => {
    const { env, store } = kvStub();
    const { db, statements } = dbStub();
    await recordHit(env, db, 'skill.download', 'a');
    await recordHit(env, db, 'skill.download', 'b');
    await recordHit(env, db, 'agent.package', scopedHitKey(1, 'agent-1'));
    await flushCounterBuffer(env);
    expect(await flushHitCounters(env, db)).toBe(3);
    expect(statements).toHaveLength(2);
    expect(statements.some((s) => s.includes('"marketplace_skills"'))).toBe(true);
    expect(store.size).toBe(0);
  });

  it('keeps a kind's keys when its statement fails, and deletes them once applied', async () => {
    const { env, store } = kvStub();
    await recordHit(env, { execute: async () => ({}) } as unknown as Db, 'skill.download', 'a');
    await flushCounterBuffer(env);
    const failing = { execute: async () => { throw new Error('neon down'); } } as unknown as Db;
    expect(await flushHitCounters(env, failing)).toBe(0);
    expect(store.size).toBe(1);
    expect(await flushHitCounters(env, dbStub().db)).toBe(1);
    expect(store.size).toBe(0);
  });

  it('skips malformed scoped keys instead of writing them', async () => {
    const { db, statements } = dbStub();
    await applyHitDeltas(db, 'landing.view', [{ kind: 'landing.view', key: 'no-tenant', n: 1, t: 0 }]);
    expect(statements).toHaveLength(0);
  });
});
