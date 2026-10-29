/**
 * The Postgres knowledge store's write rules (PRD 38 §4.2, §5.2): a relation records an
 * author only when a person wrote it, only model relations judged from a KNOWN, different
 * hash go stale, a scope never stores a NULL title, and relations are removed in bulk.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { drizzleKnowledgeStore } from './knowledgeStore';

const dialect = new PgDialect();

function fakeDb() {
  const seen: { values?: any; where?: any; set?: any } = {};
  const chain: any = {
    insert: () => ({ values: (v: unknown) => { seen.values = v; return { onConflictDoUpdate: async () => undefined }; } }),
    update: () => ({ set: (s: unknown) => { seen.set = s; return { where: (w: unknown) => { seen.where = w; return { returning: async () => [{ id: '1' }] }; } }; } }),
    delete: () => ({ where: (w: unknown) => { seen.where = w; return { returning: async () => [{ id: '1' }, { id: '2' }] }; } }),
  };
  return { db: chain as never, seen };
}

const rel = (origin: StoredRelation['origin'], to: string): StoredRelation => ({ from: 'fact:claim:a', to: to as never, kind: 'about', weight: 1, origin });

describe('drizzleKnowledgeStore', () => {
  it('stamps createdBy only on human relations', async () => {
    const { db, seen } = fakeDb();
    await drizzleKnowledgeStore(db, 1, 2).upsertRelations([rel('human', 'src:r::a'), rel('model', 'src:r::b'), rel('agent', 'src:r::c')], 'u1');
    expect(seen.values.map((v: { createdBy: string | null }) => v.createdBy)).toEqual(['u1', null, null]);
  });

  it('marks stale only model relations with a non-null source hash that differs', async () => {
    const { db, seen } = fakeDb();
    await drizzleKnowledgeStore(db, 1, 2).markRelationsStale('src:r::a.md', 'h2');
    const { sql: text } = dialect.sqlToQuery(seen.where);
    expect(text).toContain('"source_hash" is not null');
    expect(text).toContain('"source_hash" <>');
    expect(text).not.toMatch(/"source_hash" is null/);
  });

  it('never stores a NULL scope title: an empty one becomes the root id', async () => {
    const { db, seen } = fakeDb();
    await drizzleKnowledgeStore(db, 1, 2).upsertScope({ rootId: 'web:f1:', title: '', packs: ['docs'] });
    expect(seen.values.title).toBe('web:f1:');
  });

  it('removes the relations of many refs in one bulk call', async () => {
    const { db } = fakeDb();
    expect(await drizzleKnowledgeStore(db, 1, 2).deleteRelationsOf(['fact:a', 'fact:b'])).toBe(2);
  });

  it('deletes more than 500 refs in chunks of at most 500, summing what each removed', async () => {
    // Each chunk binds its refs twice (from-ref and to-ref lists) on top of a fixed
    // tenant/project predicate, so a statement's parameter count names its chunk size.
    const wheres: unknown[] = [];
    const db = { delete: () => ({ where: (w: unknown) => { wheres.push(w); return { returning: async () => [{ id: 'r' }] }; } }) } as never;
    const paramsOf = (w: unknown): number => dialect.sqlToQuery(w as never).params.length;
    const store = drizzleKnowledgeStore(db, 1, 2);

    await store.deleteRelationsOf('fact:only');
    const fixed = paramsOf(wheres[0]) - 2;
    wheres.length = 0;

    const refs = Array.from({ length: 1_200 }, (_, i) => `fact:k${i}` as never);
    expect(await store.deleteRelationsOf(refs)).toBe(3);
    expect(wheres.map((w) => (paramsOf(w) - fixed) / 2)).toEqual([500, 500, 200]);
  });

  it('makes no statement for an empty list', async () => {
    const { db, seen } = fakeDb();
    expect(await drizzleKnowledgeStore(db, 1, 2).deleteRelationsOf([])).toBe(0);
    expect(seen.where).toBeUndefined();
  });
});
