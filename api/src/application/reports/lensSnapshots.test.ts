import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { computeEngineeringInsights } from '../insights/engineeringInsights';
import {
  activeBackoff,
  LENS_SNAPSHOT_BACKOFF_KEY,
  dueSnapshots,
  owingTenantsQuery,
  rollingPeriods,
  SNAPSHOTABLE_LENSES,
} from './lensSnapshots';
import { peekCached } from '../../infrastructure/cache/readThroughCache';
import type { Env } from '../../env';

vi.mock('../insights/engineeringInsights', () => ({ computeEngineeringInsights: vi.fn() }));
vi.mock('../metrics/workforceMetrics', () => ({ computeDora: vi.fn().mockResolvedValue({}) }));
vi.mock('../insights/complianceInsights', () => ({ computeComplianceSummary: vi.fn().mockResolvedValue({}) }));
vi.mock('../insights/financeInsights', () => ({ computeFinanceInsights: vi.fn().mockResolvedValue({}) }));
vi.mock('../insights/allocationInsights', () => ({ computeAllocationInsights: vi.fn().mockResolvedValue({}) }));
vi.mock('../observability/caughtErrorReporter', () => ({ reportCaughtError: vi.fn() }));

const mockEngineering = vi.mocked(computeEngineeringInsights);

/**
 * THE TENANT WINDOW THAT NEVER MOVED. The sweep read `SELECT id FROM tenants LIMIT 100`
 * with no ORDER BY, so the same heap-order hundred were examined every tick and every
 * tenant past them was never snapshotted. `.toSQL()` never dials the connection.
 */
const sqlDb = buildDatabase({ NEON_DATABASE_URL: 'postgresql://user:pw@localhost/db' } as Parameters<typeof buildDatabase>[0]);
const periods = rollingPeriods(new Date('2026-10-17T00:00:00Z')).map((p) => p.period);

describe('owingTenantsQuery', () => {
  it('selects only tenants still owed a fresh snapshot, most-owed first, deterministically', () => {
    const { sql, params } = owingTenantsQuery(sqlDb, periods, new Date('2026-10-16T18:00:00Z'), []).toSQL();
    expect(sql).toContain('"lens_snapshots"');
    expect(sql).toMatch(/count\(\*\)/i);
    const orderBy = sql.slice(sql.toLowerCase().lastIndexOf(' order by '));
    // Fewest fresh snapshots first, then a stable tiebreak — never heap order.
    expect(orderBy).toMatch(/count\(\*\)/i);
    expect(orderBy).toContain('"tenants"."id"');
    expect(sql.toLowerCase()).toContain('limit');
    // A tenant holding every (lens, period) snapshot fresh does not qualify.
    expect(params).toContain(periods.length * SNAPSHOTABLE_LENSES.length);
  });

  it('leaves backed-off tenants out of the window', () => {
    const { sql, params } = owingTenantsQuery(sqlDb, periods, new Date(), [7, 9]).toSQL();
    expect(sql.toLowerCase()).toContain('not in');
    expect(params).toEqual(expect.arrayContaining([7, 9]));
  });
});

describe('activeBackoff', () => {
  it('keeps entries still in force and drops expired or corrupt ones', () => {
    expect(activeBackoff({ '1': 2_000, '2': 500, '3': Number.NaN }, 1_000)).toEqual({ '1': 2_000 });
    expect(activeBackoff(null, 1_000)).toEqual({});
  });
});

/** A drizzle-shaped fake: each awaited `select` chain resolves the next queued result. */
function fakeDb(selectResults: unknown[][]) {
  const queue = [...selectResults];
  const selects: number[] = [];
  const inserts: unknown[] = [];
  const chain = (result: unknown[]) => {
    const self: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy', 'limit']) self[m] = () => self;
    self.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return self;
  };
  const db = {
    select: () => { selects.push(1); return chain(queue.shift() ?? []); },
    insert: () => ({
      values: (v: unknown) => ({ onConflictDoUpdate: async () => { inserts.push(v); } }),
    }),
  } as unknown as Db;
  return { db, selects, inserts };
}

describe('dueSnapshots', () => {
  const env = {} as Env;
  const now = new Date('2026-10-17T12:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('backs a failing tenant off for one refresh interval instead of retrying it every tick', async () => {
    mockEngineering.mockRejectedValue(new Error('engineering compute blew up'));

    // tick 1: tenant 5 is owed everything; no fresh rows; finance finds no segment.
    const first = fakeDb([[{ id: 5 }], []]);
    const r1 = await dueSnapshots(env, now, first.db);
    expect(r1.failedTenants).toBe(1);
    // Every lens except the failing one still captured, for each rolling period.
    expect(r1.captured).toBe(periods.length * (SNAPSHOTABLE_LENSES.length - 1));
    // The failure is recorded as fresh-for-backoff: retry no sooner than one refresh interval.
    expect(await peekCached(env, LENS_SNAPSHOT_BACKOFF_KEY)).toEqual({ '5': now.getTime() + 6 * 60 * 60 * 1000 });

    // tick 2, five minutes later: the backoff is in force, so the sweep must ask for a
    // window that EXCLUDES tenant 5 — the fake returns no owing tenants, as Postgres would.
    const second = fakeDb([[]]);
    const r2 = await dueSnapshots(env, new Date(now.getTime() + 5 * 60_000), second.db);
    expect(r2).toEqual({ captured: 0, failedTenants: 0 });
    expect(mockEngineering).toHaveBeenCalledTimes(periods.length);
  });

  it('writes nothing and reads no freshness rows when no tenant is owed a snapshot', async () => {
    const { db, selects, inserts } = fakeDb([[]]);
    const r = await dueSnapshots(env, now, db);
    expect(r).toEqual({ captured: 0, failedTenants: 0 });
    expect(selects).toHaveLength(1);
    expect(inserts).toHaveLength(0);
  });
});
