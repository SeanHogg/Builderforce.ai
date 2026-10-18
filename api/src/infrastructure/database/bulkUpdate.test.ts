import { describe, it, expect } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { bulkUpdateById } from './bulkUpdate';

const dialect = new PgDialect();

async function capture(run: (db: { execute(q: SQL): Promise<unknown> }) => Promise<void>) {
  const seen: Array<{ sql: string; params: unknown[] }> = [];
  await run({ execute: async (q) => { seen.push(dialect.sqlToQuery(q)); return {}; } });
  return seen;
}

describe('bulkUpdateById', () => {
  it('writes N rows as ONE statement and keeps absent columns untouched', async () => {
    const seen = await capture((db) => bulkUpdateById(db, {
      table: 'workflow_tasks',
      idColumn: { name: 'id', sqlType: 'uuid' },
      columns: [{ name: 'status', sqlType: 'workflow_task_status' }, { name: 'output', sqlType: 'text' }],
      rows: [
        { id: 'a', set: { status: 'completed', output: 'x' } },
        { id: 'b', set: { status: 'failed' } },
      ],
    }));
    expect(seen).toHaveLength(1);
    expect(seen[0].sql).toContain('UPDATE "workflow_tasks" AS t');
    expect(seen[0].sql).toContain('CASE WHEN v."output__set" THEN v."output" ELSE t."output" END');
    // row b leaves `output` alone: its flag is false and the value NULL
    expect(seen[0].params).toEqual(['a', true, 'completed', true, 'x', 'b', true, 'failed', false, null]);
  });

  it('is a no-op for an empty row set', async () => {
    const seen = await capture((db) => bulkUpdateById(db, {
      table: 't', idColumn: { name: 'id', sqlType: 'int' }, columns: [{ name: 'c', sqlType: 'int' }], rows: [],
    }));
    expect(seen).toHaveLength(0);
  });

  it('serialises dates as ISO strings', async () => {
    const d = new Date('2026-01-02T03:04:05.000Z');
    const seen = await capture((db) => bulkUpdateById(db, {
      table: 't', idColumn: { name: 'id', sqlType: 'int' }, columns: [{ name: 'at', sqlType: 'timestamp' }],
      rows: [{ id: 1, set: { at: d } }],
    }));
    expect(seen[0].params).toContain('2026-01-02T03:04:05.000Z');
  });
});
