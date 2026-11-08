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
  const params: unknown[][] = [];
  const db = {
    execute: async (q: SQL) => {
      const built = new PgDialect().sqlToQuery(q);
      statements.push(built.sql);
      params.push(built.params);
      return {};
    },
  } as unknown as Db;
  return { db, statements, params };
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

  it('keeps the keys of a failed kind when its statement fails, and deletes them once applied', async () => {
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

  it('seo.impression updates marketing_seo_pages by path, platform (NULL tenant) and path containing ":" included', async () => {
    const { db, statements, params } = dbStub();
    await applyHitDeltas(db, 'seo.impression', [
      { kind: 'seo.impression', key: scopedHitKey(null, '/salary/engineer/london'), n: 2, t: 0 },
      { kind: 'seo.impression', key: scopedHitKey(7, '/a:b'), n: 1, t: 0 },
    ]);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"marketing_seo_pages"');
    expect(statements[0]).toContain('"impression_count"');
    expect(statements[0]).toContain('"path"');
    // The split is on the FIRST ':' only: tenant part vs path part (which keeps its own ':').
    const rows = JSON.parse(params[0]!.find((p) => typeof p === 'string' && p.startsWith('[')) as string) as
      { k: string; tn: number | null }[];
    expect(rows).toEqual([
      expect.objectContaining({ k: '/salary/engineer/london', tn: null }),
      expect.objectContaining({ k: '/a:b', tn: 7 }),
    ]);
  });

  it('seo.impression only counts published pages; the other kinds carry no extra predicate', async () => {
    const { db, statements } = dbStub();
    await applyHitDeltas(db, 'seo.impression', [{ kind: 'seo.impression', key: scopedHitKey(null, '/p'), n: 1, t: 0 }]);
    expect(statements[0]).toContain(`t.status = 'published'`);
    const others = [
      ['skill.download', 'a'],
      ['agent.package', scopedHitKey(1, 'x')],
      ['enrichment.hit', scopedHitKey(null, 4)],
      ['landing.view', scopedHitKey(1, 2)],
      ['landing.convert', scopedHitKey(1, 2)],
    ] as const;
    for (const [kind, key] of others) {
      const probe = dbStub();
      await applyHitDeltas(probe.db, kind, [{ kind, key, n: 1, t: 0 }]);
      expect(probe.statements[0]).not.toContain(`'published'`);
    }
  });

  it('writes straight to the database when CACHE_L2_KV is off — no KV write spent', async () => {
    const { env, store } = kvStub();
    const { db, statements } = dbStub();
    await recordHit({ ...env, CACHE_L2_KV: 'false' }, db, 'skill.download', 'a');
    expect(store.size).toBe(0);
    expect(statements).toHaveLength(1);
  });

  it('falls back to the database when the KV put fails instead of re-queueing in memory', async () => {
    const { env, store } = kvStub();
    const kv = env.AUTH_CACHE_KV as unknown as { put: () => Promise<void> };
    kv.put = async () => { throw new Error('KV put() limit exceeded for the day'); };
    const { db, statements } = dbStub();
    await recordHit(env, db, 'skill.download', 'a');
    expect(store.size).toBe(0);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain('"marketplace_skills"');
    // Nothing left pending to retry the exhausted quota.
    await flushCounterBuffer(env);
    expect(statements).toHaveLength(1);
  });
});
