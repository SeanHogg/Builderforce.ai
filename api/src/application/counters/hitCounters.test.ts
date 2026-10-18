import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { applyHitDeltas, flushHitCounters, recordHit, scopedHitKey } from './hitCounters';

function kvStub() {
  const store = new Map<string, string>();
  const kv = {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  } as unknown as KVNamespace;
  return { env: { AUTH_CACHE_KV: kv } as Env, store };
}

function dbStub() {
  const statements: string[] = [];
  const db = { execute: async (q: SQL) => { statements.push(new PgDialect().sqlToQuery(q).sql); return {}; } } as unknown as Db;
  return { db, statements };
}

describe('hit counters', () => {
  it('buffers hits in KV without touching the database', async () => {
    const { env, store } = kvStub();
    const { db, statements } = dbStub();
    await recordHit(env, db, 'skill.download', 'my-skill');
    await recordHit(env, db, 'skill.download', 'my-skill');
    expect(statements).toHaveLength(0);
    expect([...store.values()].map((v) => JSON.parse(v).n)).toEqual([2]);
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
    expect(await flushHitCounters(env, db)).toBe(3);
    expect(statements).toHaveLength(2);
    expect(statements.some((s) => s.includes('"marketplace_skills"'))).toBe(true);
    expect(store.size).toBe(0);
  });

  it('skips malformed scoped keys instead of writing them', async () => {
    const { db, statements } = dbStub();
    await applyHitDeltas(db, 'landing.view', [{ kind: 'landing.view', key: 'no-tenant', n: 1, t: 0 }]);
    expect(statements).toHaveLength(0);
  });
});
