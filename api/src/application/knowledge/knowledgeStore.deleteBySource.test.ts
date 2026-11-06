/**
 * deleteFactsBySource works per batch — the batch's `fact:` relations first, then its facts —
 * so a failure part way leaves no relation pointing at a deleted fact, and a retry finishes.
 */
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { projectFactRelations, projectFacts } from '../../infrastructure/database/schema';
import { drizzleKnowledgeStore } from './knowledgeStore';

const dialect = new PgDialect();
const SOURCE = 'pack:docs-1a2b3c4d';

/** A tiny table model: facts (id → key), relations, and a switch that fails the Nth fact delete. */
function fakeDb(factCount: number) {
  const facts = new Map<string, string>(Array.from({ length: factCount }, (_, i) => [`id${i}`, `k${i}`] as const));
  let relations = [
    { from: 'fact:k0', to: 'fact:k1200' },   // spans batch 1 and batch 2
    { from: 'fact:k1100', to: 'fact:k1300' }, // inside batch 2
    { from: 'fact:k5', to: 'src:other::a.md' },
  ];
  const state = { factDeletes: 0, failOnFactDelete: 0 };
  const paramsOf = (where: unknown): unknown[] => dialect.sqlToQuery(where as never).params;
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async (n: number) => [...facts].slice(0, n).map(([id, key]) => ({ id, key })) }) }) }),
    delete: (table: unknown) => ({
      where: (where: unknown) => ({
        returning: async () => {
          const params = paramsOf(where);
          if (table === projectFacts) {
            state.factDeletes += 1;
            if (state.factDeletes === state.failOnFactDelete) throw new Error('batch failed');
            const ids = params.filter((p): p is string => typeof p === 'string' && facts.has(p));
            const keys = ids.map((id) => ({ key: facts.get(id)! }));
            for (const id of ids) facts.delete(id);
            return keys;
          }
          expect(table).toBe(projectFactRelations);
          const refs = new Set(params.filter((p): p is string => typeof p === 'string' && p.startsWith('fact:')));
          const gone = relations.filter((r) => refs.has(r.from) || refs.has(r.to));
          relations = relations.filter((r) => !gone.includes(r));
          return gone.map(() => ({ id: 'r' }));
        },
      }),
    }),
  };
  const dangling = () => relations.filter((r) => [r.from, r.to].some((ref) => ref.startsWith('fact:') && ![...facts.values()].includes(ref.slice(5))) );
  return { db: db as never, facts, state, relations: () => relations, dangling };
}

describe('drizzleKnowledgeStore.deleteFactsBySource', () => {
  it('deletes a pack of more than one batch, relations before facts, and reports both', async () => {
    const f = fakeDb(1_500);
    const out = await drizzleKnowledgeStore(f.db, 1, 2).deleteFactsBySource(SOURCE);
    expect(out.keys).toHaveLength(1_500);
    expect(out.relations).toBe(3);
    expect(f.facts.size).toBe(0);
    expect(f.relations()).toEqual([]);
  });

  it('a failure on batch 2 leaves no dangling relation, and the retry finishes', async () => {
    const f = fakeDb(1_500);
    f.state.failOnFactDelete = 2;
    const store = drizzleKnowledgeStore(f.db, 1, 2);
    await expect(store.deleteFactsBySource(SOURCE)).rejects.toThrow('batch failed');
    expect(f.facts.size).toBe(500);
    expect(f.dangling()).toEqual([]);

    const out = await store.deleteFactsBySource(SOURCE);
    expect(out.keys).toHaveLength(500);
    expect(f.facts.size).toBe(0);
    expect(f.dangling()).toEqual([]);
  });
});
