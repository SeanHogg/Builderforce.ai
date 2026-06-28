import { describe, it, expect } from 'vitest';
import { importBoardRows, isImportDataset, IMPORT_DATASETS } from './boardImport';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';

/** Fake db that captures the values passed to insert(...).values(...). */
function fakeDb() {
  const captured: { table: unknown; rows: Array<Record<string, unknown>> } = { table: null, rows: [] };
  const db = {
    insert(table: unknown) {
      captured.table = table;
      return { values: async (rows: Array<Record<string, unknown>>) => { captured.rows = rows; } };
    },
  } as unknown as Db;
  return { db, captured };
}

const env = {} as Env; // no AUTH_CACHE_KV → bumpCacheVersion degrades to a no-op

describe('boardImport', () => {
  it('knows its datasets', () => {
    expect(isImportDataset('rd-financials')).toBe(true);
    expect(isImportDataset('nope')).toBe(false);
    expect(Object.keys(IMPORT_DATASETS)).toContain('headcount-events');
  });

  it('coerces numbers/dates and injects tenantId', async () => {
    const { db, captured } = fakeDb();
    const res = await importBoardRows(db, env, 7, 'rd-financials', [
      { fiscalYear: '2026', quarter: '2', category: 'headcount', actualUsd: '1000.50', planUsd: '1200' },
    ]);
    expect(res.inserted).toBe(1);
    expect(captured.rows[0]).toMatchObject({ tenantId: 7, fiscalYear: 2026, quarter: 2, category: 'headcount', actualUsd: 1000.5, planUsd: 1200 });
  });

  it('coerces a date column to YYYY-MM-DD and a bool', async () => {
    const { db, captured } = fakeDb();
    await importBoardRows(db, env, 7, 'headcount-events', [
      { eventType: 'leave', effectiveOn: '2026-03-05T12:00:00Z', isVoluntary: 'true' },
    ]);
    expect(captured.rows[0]!.effectiveOn).toBe('2026-03-05');
    expect(captured.rows[0]!.isVoluntary).toBe(true);
  });

  it('skips rows missing a required column and reports it', async () => {
    const { db } = fakeDb();
    const res = await importBoardRows(db, env, 7, 'positions', [
      { reqTitle: 'UX Lead' },          // ok
      { priority: 'high' },             // missing reqTitle → skipped
    ]);
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(1);
    expect(res.errors.some((e) => e.includes('reqTitle'))).toBe(true);
  });

  it('rejects an unknown dataset', async () => {
    const { db } = fakeDb();
    const res = await importBoardRows(db, env, 7, 'bogus', [{ a: 1 }]);
    expect(res.inserted).toBe(0);
    expect(res.errors[0]).toContain('unknown dataset');
  });
});
