/**
 * The multi-row fact writer (PRD 41 A11 rule 4a): the REAL statement builder, not a mock of it. The conflict update is
 * rendered to SQL text with drizzle's own dialect and pinned, and a batch is driven through `upsertProjectFacts` against
 * a recording db to prove the statement count and shapes.
 */
import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

vi.mock('./projectFactsStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./projectFactsStore')>()),
  bumpProjectFactsVersion: vi.fn(async () => undefined),
}));

import { batchConflictSet, upsertProjectFacts } from './projectFactsWrite';

const dialect = new PgDialect();
const text = (v: unknown): string => dialect.sqlToQuery(v as SQL).sql;

/** A db that records every insert and answers every read with nothing. */
function recordingDb() {
  const inserts: Array<{ values: unknown; set: Record<string, unknown> }> = [];
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
    insert: () => ({
      values: (values: unknown) => ({
        onConflictDoUpdate: async (c: { set: Record<string, unknown> }) => { inserts.push({ values, set: c.set }); },
      }),
    }),
  };
  return { db: db as never, inserts };
}

const fact = (i: number) => ({ key: `claim:${i}`, content: `claim number ${i}`, source: 'review', opts: { factOrigin: 'model' as const, fileAnchors: [{ path: 'a.ts', contentHash: 'h' }], retireByAnchor: false } });

describe('batchConflictSet — the SET of a multi-row upsert, as SQL text', () => {
  const set = batchConflictSet(new Date(0));

  it('takes the incoming content, importance, hash and anchors from `excluded`', () => {
    expect(text(set['content'])).toBe('excluded."content"');
    expect(text(set['contentHash'])).toBe('excluded."content_hash"');
    expect(text(set['importance'])).toBe('excluded."importance"');
    expect(set['supersededBy']).toBeNull(); // a fresh assertion revives a retired row, as the single path does
  });

  it('keeps the stored vector when the content hash is unchanged, else takes the incoming (cleared) one', () => {
    for (const k of ['embedding', 'embeddingModel', 'embeddedAt', 'embedding1024', 'embedding1024Model', 'embedded1024At']) {
      const sqlText = text(set[k]);
      expect(sqlText).toMatch(/^CASE WHEN "project_facts"\."content_hash" IS NOT DISTINCT FROM excluded\."content_hash" THEN "project_facts"\."\w+" ELSE excluded\."\w+" END$/);
    }
  });

  it('never wipes an origin or cost stamp a rewrite does not know: COALESCE(excluded, stored)', () => {
    for (const k of ['origin', 'originExecutionId', 'originModel', 'originPromptTokens', 'originCompletionTokens']) {
      expect(text(set[k])).toMatch(/^COALESCE\(excluded\."\w+", "project_facts"\."\w+"\)$/);
    }
  });
});

describe('upsertProjectFacts', () => {
  it('writes 450 facts as three multi-row statements (200, 200, 50), each updating from `excluded`', async () => {
    const { db, inserts } = recordingDb();
    const written = await upsertProjectFacts({} as never, db, 1, 2, Array.from({ length: 450 }, (_, i) => fact(i)), { deferVersionBump: true });
    expect(written.size).toBe(450);
    expect(inserts.map((i) => (i.values as unknown[]).length)).toEqual([200, 200, 50]);
    expect(text(inserts[0]!.set['content'])).toBe('excluded."content"');
    expect(inserts[0]!.values).toEqual(expect.arrayContaining([expect.objectContaining({ tenantId: 1, projectId: 2, key: 'claim:0', origin: 'model' })]));
  });

  it('a lone fact keeps the long-standing single-row statement with its literal update', async () => {
    const { db, inserts } = recordingDb();
    await upsertProjectFacts({} as never, db, 1, 2, [fact(1)], { embed: false, deferVersionBump: true });
    expect(inserts).toHaveLength(1);
    expect(Array.isArray(inserts[0]!.values)).toBe(false);
    expect(inserts[0]!.set['content']).toBe('claim number 1');
  });

  it('a later write of the same key replaces an earlier one inside the batch (one row, not a conflict with itself)', async () => {
    const { db, inserts } = recordingDb();
    const written = await upsertProjectFacts({} as never, db, 1, 2, [fact(1), { ...fact(1), content: 'second' }, fact(2)], { deferVersionBump: true });
    expect([...written].sort()).toEqual(['claim:1', 'claim:2']);
    const rows = inserts[0]!.values as Array<{ key: string; content: string }>;
    expect(rows.find((r) => r.key === 'claim:1')?.content).toBe('second');
  });

  it('skips an empty key or content like the single path does', async () => {
    const { db, inserts } = recordingDb();
    const written = await upsertProjectFacts({} as never, db, 1, 2, [fact(1), { ...fact(2), content: '  ' }, { ...fact(3), key: ' ' }], { deferVersionBump: true });
    expect([...written]).toEqual(['claim:1']);
    expect(inserts).toHaveLength(1);
  });
});
