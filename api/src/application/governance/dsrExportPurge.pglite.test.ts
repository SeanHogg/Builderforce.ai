/**
 * The stale DSR export purge against REAL Postgres (PGlite): the keyset walk, the oldest-first
 * order and the per-row backoff are SQL, so they are proven on SQL.
 */
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../infrastructure/database/connection';

const h = vi.hoisted(() => ({ deleted: [] as string[] }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));
vi.mock('../assets/tenantAssetStore', () => ({
  deletePrivateObject: vi.fn(async (_bucket: unknown, key: string) => {
    if (key.includes('bad')) throw new Error('R2 refused');
    h.deleted.push(key);
    return true;
  }),
}));
vi.setConfig({ hookTimeout: 60_000, testTimeout: 60_000 });

import { reportCaughtError } from '../observability/caughtErrorReporter';
import { PURGE_ATTEMPTS_PER_SWEEP, purgeBackoffMs, purgeStaleDsrExports } from './dsrExportPurge';

let pg: PGlite;
let db: Db;
const bucket = {} as R2Bucket;
const NOW = new Date('2026-06-01T00:00:00Z');

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`CREATE TABLE data_subject_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id integer NOT NULL, status varchar(32) NOT NULL,
    execution_result text, updated_at timestamp NOT NULL DEFAULT now())`);
  db = drizzle(pg) as unknown as Db;
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('TRUNCATE data_subject_requests');
  h.deleted.length = 0;
  vi.mocked(reportCaughtError).mockClear();
});

/** A stale undelivered export, `daysOld` days before NOW (fractional days keep the order strict). */
async function stale(key: string, daysOld: number): Promise<void> {
  const result = { status: 'processing', exportKey: key, note: null };
  await pg.query(
    `INSERT INTO data_subject_requests (tenant_id, status, execution_result, updated_at) VALUES (1, 'processing', $1, $2)`,
    [JSON.stringify(result), new Date(NOW.getTime() - daysOld * 86_400_000).toISOString()],
  );
}

const resultOf = async (key: string) => JSON.parse((await pg.query<{ execution_result: string }>(
  `SELECT execution_result FROM data_subject_requests WHERE execution_result LIKE $1`, [`%${key}%`],
)).rows[0]!.execution_result);

describe('purgeStaleDsrExports', () => {
  it('walks oldest first and leaves exports inside the retention window alone', async () => {
    await stale('1/a/new.json', 31);
    await stale('1/a/old.json', 90);
    await stale('1/a/fresh.json', 5);
    expect(await purgeStaleDsrExports(db, bucket, NOW)).toBe(2);
    expect(h.deleted).toEqual(['1/a/old.json', '1/a/new.json']);
    expect((await resultOf('fresh.json')).exportKey).toBe('1/a/fresh.json');
  });

  it('regression: rows whose delete keeps failing cannot starve the rows behind them', async () => {
    // More failing rows than one sweep attempts, all OLDER than the healthy row.
    for (let i = 0; i <= PURGE_ATTEMPTS_PER_SWEEP; i += 1) await stale(`1/a/bad-${i}.json`, 200 - i / 100);
    await stale('1/a/good.json', 40);

    expect(await purgeStaleDsrExports(db, bucket, NOW)).toBe(0); // every attempt this sweep failed
    const first = await resultOf('bad-0.json');
    expect(first.exportKey).toBe('1/a/bad-0.json');
    expect(first.exportPurge).toEqual({ failures: 1, nextAttemptAt: new Date(NOW.getTime() + purgeBackoffMs(1)).toISOString() });
    expect(vi.mocked(reportCaughtError)).toHaveBeenCalledTimes(PURGE_ATTEMPTS_PER_SWEEP);

    // Next sweep, still inside the backoff: the failed rows are passed over, the queue moves on.
    const later = new Date(NOW.getTime() + 60_000);
    expect(await purgeStaleDsrExports(db, bucket, later)).toBe(1);
    expect(h.deleted).toEqual(['1/a/good.json']);
    // The purged row no longer names its key anywhere.
    expect((await pg.query(`SELECT 1 FROM data_subject_requests WHERE execution_result LIKE '%good.json%'`)).rows).toHaveLength(0);
    expect((await resultOf('bad-0.json')).exportPurge.failures).toBe(1); // not retried in backoff
  });

  it('a failed row is retried once its backoff has passed, and the count grows', async () => {
    await stale('1/a/bad-x.json', 60);
    await purgeStaleDsrExports(db, bucket, NOW);
    await purgeStaleDsrExports(db, bucket, new Date(NOW.getTime() + purgeBackoffMs(1) + 1));
    expect((await resultOf('bad-x.json')).exportPurge.failures).toBe(2);
  });

  it('backs off exponentially, capped at a week', () => {
    expect(purgeBackoffMs(1)).toBe(3_600_000);
    expect(purgeBackoffMs(3)).toBe(4 * 3_600_000);
    expect(purgeBackoffMs(50)).toBe(7 * 24 * 3_600_000);
  });
});
