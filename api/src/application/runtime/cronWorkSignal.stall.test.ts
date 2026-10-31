import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * publishNextDue's stall detection — the half of the bounded `due` window that turns
 * "the gate declines to act on this" into "an operator can see it is jammed".
 *
 * The `MIN(next_run_at)` probes are the only DB contact, so the connection is stubbed. Each of the
 * six schedule tables answers two columns, in SCHEDULE_SOURCES order: workflow_triggers,
 * ceremony_schedules, report_schedules, qa_schedules, marketing_campaigns, social_campaigns.
 * (`cron_jobs` is deliberately absent: its poller, not a server sweep, executes those rows.)
 *
 *   m<i>  the earliest armed row, stuck ones included — what the stall report reads
 *   f<i>  the earliest armed row that is NOT stuck — what the gate is given
 *
 * `armProbes` feeds the m column. The f column is derived from it the way the SQL derives it
 * (a row due no longer ago than one floor interval), unless a test overrides it with
 * `armFresh` to put a stuck row and a later row in the same table.
 */
const probeResults: Array<Date | null> = [];
const freshOverrides: Array<Date | null | undefined> = [];
const SCHEDULE_PROBE_COLUMNS = ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'];
let statements = 0;
let lastStatement: unknown;

vi.mock('../../infrastructure/database/connection', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../infrastructure/database/connection')>()),
  buildDatabase: () => ({
    // ONE statement carries every probe: one column per table, in SCHEDULE_SOURCES order.
    execute: async (statement: unknown) => {
      statements += 1;
      lastStatement = statement;
      const row: Record<string, Date | null> = {};
      SCHEDULE_PROBE_COLUMNS.forEach((c) => { row[c] = probeResults.shift() ?? null; });
      SCHEDULE_PROBE_COLUMNS.forEach((_, i) => {
        const plain = row[`m${i}`] ?? null;
        const override = freshOverrides[i];
        // Not stuck = due no longer ago than one floor interval (or not due yet).
        row[`f${i}`] = override !== undefined ? override : plain && NOW - plain.getTime() <= FLOOR_INTERVAL_MS ? plain : null;
      });
      return { rows: [row] };
    },
  }),
}));

const reported: Array<{ operation: string; level?: string }> = [];
vi.mock('../observability/caughtErrorReporter', () => ({
  reportCaughtError: (_error: unknown, details: { operation: string; level?: string }) => {
    reported.push({ operation: details.operation, level: details.level });
  },
}));

const { publishNextDue, readScheduleStall, FLOOR_INTERVAL_MS } = await import('./cronWorkSignal');
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Env } from '../../env';

function fakeKv(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed));
  return {
    kv: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
      delete: async (k: string) => { store.delete(k); },
    } as unknown as KVNamespace,
    store,
  };
}

const envWith = (kv?: KVNamespace): Env => ({ AUTH_CACHE_KV: kv, NEON_DATABASE_URL: 'postgres://x' } as Env);

/** Feed the probes, in SCHEDULE_SOURCES order; any left out read as "nothing armed". */
function armProbes(...values: Array<Date | null>) {
  probeResults.length = 0;
  probeResults.push(...values);
}

/** Override the not-stuck answer of one table: a stuck row AND a later row in the same table. */
function armFresh(index: number, value: Date | null) {
  freshOverrides[index] = value;
}

const NOW = 10 * FLOOR_INTERVAL_MS;
const at = (ms: number) => new Date(ms);

beforeEach(() => {
  reported.length = 0;
  probeResults.length = 0;
  freshOverrides.length = 0;
  statements = 0;
});

describe('publishNextDue', () => {
  it('publishes the earliest armed due time and reports no stall when everything is fresh', async () => {
    const { kv, store } = fakeKv();
    armProbes(at(NOW + 60_000), at(NOW + 30_000), null, null);
    const result = await publishNextDue(envWith(kv), NOW);
    expect(result.earliestMs).toBe(NOW + 30_000);
    expect(result.stall).toBeNull();
    expect(store.get('cron:next-due')).toBe(String(NOW + 30_000));
  });

  it('reads every table in ONE statement', async () => {
    const { kv } = fakeKv();
    armProbes(at(NOW + 60_000), null, at(NOW + 5_000), null);
    await publishNextDue(envWith(kv), NOW);
    expect(statements).toBe(1);
  });

  describe('campaign sources', () => {
    it('publishes a scheduled email campaign so the gate wakes for it without the floor', async () => {
      const { kv, store } = fakeKv();
      armProbes(null, null, null, null, at(NOW + 90_000), null);
      const result = await publishNextDue(envWith(kv), NOW);
      expect(result.perTable).toEqual([{ table: 'marketing_campaigns', nextDueMs: NOW + 90_000 }]);
      expect(store.get('cron:next-due')).toBe(String(NOW + 90_000));
    });

    it('publishes a scheduled social campaign, and the earliest across all sources wins', async () => {
      const { kv, store } = fakeKv();
      armProbes(at(NOW + 600_000), null, null, null, at(NOW + 300_000), at(NOW + 120_000));
      const result = await publishNextDue(envWith(kv), NOW);
      expect(result.perTable.map((m) => m.table)).toEqual(['workflow_triggers', 'marketing_campaigns', 'social_campaigns']);
      expect(store.get('cron:next-due')).toBe(String(NOW + 120_000));
    });

    it('names a campaign table in the stall report when its send time has been missed for a whole floor', async () => {
      const { kv } = fakeKv();
      armProbes(null, null, null, null, null, at(NOW - 2 * FLOOR_INTERVAL_MS));
      const result = await publishNextDue(envWith(kv), NOW);
      expect(result.stall?.tables.map((t) => t.table)).toEqual(['social_campaigns']);
    });

    /** The predicate must be the sweeps' own: a draft with a send time, a `scheduled` social campaign. */
    it('arms an email campaign only as a draft with a send time, and a social one only as scheduled', async () => {
      const { kv } = fakeKv();
      armProbes();
      await publishNextDue(envWith(kv), NOW);
      const { sql: text, params } = new PgDialect().sqlToQuery(lastStatement as Parameters<PgDialect['sqlToQuery']>[0]);
      expect(text).toMatch(/FROM "marketing_campaigns"\s+WHERE "marketing_campaigns"\."status" in \(\$\d+\) AND "marketing_campaigns"\."scheduled_at" IS NOT NULL/i);
      expect(text).toMatch(/FROM "social_campaigns"\s+WHERE "social_campaigns"\."status" in \(\$\d+\) AND "social_campaigns"\."scheduled_at" IS NOT NULL/i);
      expect(params).toEqual(expect.arrayContaining(['draft', 'scheduled']));
    });
  });

  describe('a stuck row does not shadow the rest of the platform', () => {
    /**
     * A refused scheduled campaign keeps its past `scheduled_at` by design, so it reads `stuck`
     * for as long as nobody fixes it. The gate looks at ONE stamp: published as the plain MIN,
     * that one row would hide every later due time on the platform.
     */
    it('stamps the later, not-stuck row when a stuck row and a future row share a table', async () => {
      const { kv, store } = fakeKv();
      const stuck = at(NOW - 4 * FLOOR_INTERVAL_MS);
      const future = at(NOW + 90_000);
      armProbes(null, null, null, null, stuck, null);
      armFresh(4, future);
      const result = await publishNextDue(envWith(kv), NOW);
      expect(result.earliestMs).toBe(NOW + 90_000);
      expect(store.get('cron:next-due')).toBe(String(NOW + 90_000));
      // The stuck row is still REPORTED, from the plain minimum.
      expect(result.perTable).toEqual([{ table: 'marketing_campaigns', nextDueMs: stuck.getTime() }]);
      expect(result.stall?.tables.map((t) => t.table)).toEqual(['marketing_campaigns']);
    });

    it('stamps a future row in one table over a stuck row in another', async () => {
      const { kv, store } = fakeKv();
      armProbes(null, null, at(NOW + 45_000), null, at(NOW - 4 * FLOOR_INTERVAL_MS), null);
      const result = await publishNextDue(envWith(kv), NOW);
      expect(store.get('cron:next-due')).toBe(String(NOW + 45_000));
      expect(result.stall?.tables.map((t) => t.table)).toEqual(['marketing_campaigns']);
    });

    it('publishes "none" when every armed row is stuck, and still reports the jam', async () => {
      const { kv, store } = fakeKv();
      armProbes(at(NOW - 3 * FLOOR_INTERVAL_MS), null, null, null, at(NOW - 2 * FLOOR_INTERVAL_MS), null);
      const result = await publishNextDue(envWith(kv), NOW);
      expect(result.earliestMs).toBeNull();
      expect(store.get('cron:next-due')).toBe('none');
      expect(result.stall?.tables.map((t) => t.table)).toEqual(['workflow_triggers', 'marketing_campaigns']);
    });

    it('asks the database for the not-stuck minimum with the SAME window classifyDueTime uses', async () => {
      const { kv } = fakeKv();
      armProbes();
      await publishNextDue(envWith(kv), NOW);
      const { sql: text, params } = new PgDialect().sqlToQuery(lastStatement as Parameters<PgDialect['sqlToQuery']>[0]);
      for (const i of [0, 1, 2, 3, 4, 5]) {
        expect(text).toContain(`AS m${i}`);
        expect(text).toContain(`AS f${i}`);
      }
      expect(text.match(/>= NOW\(\) - /g)).toHaveLength(6);
      // The window is the floor interval, in seconds — the classifier's own bound.
      expect(params.filter((p) => p === FLOOR_INTERVAL_MS / 1000)).toHaveLength(6);
    });
  });

  it('publishes the "none" sentinel when nothing is armed', async () => {
    const { kv, store } = fakeKv();
    armProbes(null, null, null, null);
    await expect(publishNextDue(envWith(kv), NOW)).resolves.toMatchObject({ earliestMs: null, stall: null });
    expect(store.get('cron:next-due')).toBe('none');
  });

  /** A row due 90 seconds ago is a schedule waiting its turn, not a jam. */
  it('does not call a recently-due row stuck', async () => {
    const { kv } = fakeKv();
    armProbes(at(NOW - 90_000), null, null, null);
    const result = await publishNextDue(envWith(kv), NOW);
    expect(result.stall).toBeNull();
    expect(reported).toHaveLength(0);
  });

  it('raises a warning and names the jammed tables when a row is overdue past the floor', async () => {
    const { kv } = fakeKv();
    armProbes(null, null, at(NOW - 4 * FLOOR_INTERVAL_MS), at(NOW - 2 * FLOOR_INTERVAL_MS));
    const result = await publishNextDue(envWith(kv), NOW);

    expect(result.stall?.tables.map((t) => t.table)).toEqual(['report_schedules', 'qa_schedules']);
    expect(result.stall?.tables[0]?.overdueMs).toBe(4 * FLOOR_INTERVAL_MS);
    expect(result.stall?.firstDetectedMs).toBe(NOW);
    expect(reported).toEqual([{ operation: 'scheduleStall', level: 'warning' }]);
    // Readable by the cron panel without a second DB round-trip.
    await expect(readScheduleStall(envWith(kv))).resolves.toMatchObject({ observations: 1 });
  });

  /**
   * The two properties that make the report usable: the age is carried, not restamped,
   * and the log line is rate-limited to one per floor interval — a jam persists until
   * somebody fixes it, and active ticks are five minutes apart.
   */
  it('carries the first-detected time across ticks and rate-limits the raise', async () => {
    const { kv } = fakeKv();
    const stuck = at(NOW - 4 * FLOOR_INTERVAL_MS);

    armProbes(stuck, null, null, null);
    await publishNextDue(envWith(kv), NOW);
    expect(reported).toHaveLength(1);

    // Five minutes later — same jam, well inside the raise window.
    armProbes(stuck, null, null, null);
    const second = await publishNextDue(envWith(kv), NOW + 300_000);
    expect(second.stall?.firstDetectedMs).toBe(NOW);
    expect(second.stall?.observations).toBe(2);
    expect(reported).toHaveLength(1);

    // Past a full floor interval — raised again so a long jam does not go quiet.
    armProbes(stuck, null, null, null);
    const third = await publishNextDue(envWith(kv), NOW + FLOOR_INTERVAL_MS + 1);
    expect(third.stall?.firstDetectedMs).toBe(NOW);
    expect(third.stall?.observations).toBe(3);
    expect(reported).toHaveLength(2);
  });

  /** Clearing is explicit, so the panel goes green the moment the sweeps catch up. */
  it('deletes the stall report once nothing is overdue', async () => {
    const { kv, store } = fakeKv();
    armProbes(at(NOW - 4 * FLOOR_INTERVAL_MS), null, null, null);
    await publishNextDue(envWith(kv), NOW);
    expect(store.has('cron:schedule-stall')).toBe(true);

    armProbes(at(NOW + 60_000), null, null, null);
    await expect(publishNextDue(envWith(kv), NOW)).resolves.toMatchObject({ stall: null });
    expect(store.has('cron:schedule-stall')).toBe(false);
  });

  it('is a no-op when KV is unbound — the publish exists only to feed the gate', async () => {
    await expect(publishNextDue(envWith(), NOW)).resolves.toEqual({ earliestMs: null, perTable: [], stall: null });
  });
});
