import { describe, expect, it } from 'vitest';
import { lt } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { apiErrorLog } from '../../infrastructure/database/schema';
import { boundedDelete, PURGE_BATCH_ROWS, runPurgeBatch, type PurgeStatement } from './boundedPurge';
import { SWEPT_TABLES } from './sweptTables';

const realDb = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);
const toSQL = (s: PurgeStatement) => (s as unknown as { toSQL(): { sql: string; params: unknown[] } }).toSQL();

describe('boundedDelete', () => {
  it('deletes at most PURGE_BATCH_ROWS rows chosen by the expiry predicate', () => {
    const q = toSQL(boundedDelete(realDb, apiErrorLog, lt(apiErrorLog.createdAt, new Date('2026-01-01T00:00:00Z'))));
    expect(q.sql).toMatch(/^delete from "api_error_log" where ctid = any\(array\(select ctid from "api_error_log" where .* limit \$\d+\)\)$/);
    expect(q.params).toContain(PURGE_BATCH_ROWS);
  });

  it('every swept relation purges through a bounded statement', () => {
    for (const table of SWEPT_TABLES) {
      const q = toSQL(table.purge(realDb, new Date('2026-01-01T00:00:00Z')));
      expect(q.sql, table.relation).toContain('limit');
      expect(q.sql, table.relation).toContain('ctid');
    }
  });
});

describe('runPurgeBatch', () => {
  const stmt = (name: string) => ({ name, statement: name as unknown as PurgeStatement });

  it('sends every purge for an endpoint in ONE round trip', async () => {
    const calls: unknown[][] = [];
    const db = { batch: async (items: unknown[]) => { calls.push(items); return []; } } as unknown as Db;
    const failed: string[] = [];
    await runPurgeBatch(db, [stmt('a'), stmt('b'), stmt('c')], (n) => failed.push(n));
    expect(calls).toEqual([['a', 'b', 'c']]);
    expect(failed).toEqual([]);
  });

  it('falls back to per-table on a batch failure so one bad table cannot stop the others', async () => {
    const executed: string[] = [];
    const db = {
      batch: async (items: string[]) => {
        if (items.includes('bad')) throw new Error('boom');
        executed.push(...items);
        return [];
      },
    } as unknown as Db;
    const failed: string[] = [];
    await runPurgeBatch(db, [stmt('a'), stmt('bad'), stmt('c')], (n) => failed.push(n));
    expect(executed).toEqual(['a', 'c']);
    expect(failed).toEqual(['bad']);
  });

  it('is a no-op with nothing to purge', async () => {
    const db = { batch: async () => { throw new Error('should not be called'); } } as unknown as Db;
    await expect(runPurgeBatch(db, [], () => undefined)).resolves.toBeUndefined();
  });
});
