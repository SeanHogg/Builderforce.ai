import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * publishNextDue's stall detection — the half of the bounded `due` window that turns
 * "the gate declines to act on this" into "an operator can see it is jammed".
 *
 * The five `MIN(next_run_at)` probes are the only DB contact, so the connection is
 * stubbed and each probe is fed a per-table answer in SCHEDULE_SOURCES order:
 * workflow_triggers, cron_jobs, ceremony_schedules, report_schedules, qa_schedules.
 */
const probeResults: Array<Date | null> = [];

vi.mock('../../infrastructure/database/connection', () => ({
  buildDatabase: () => ({
    select: () => {
      const min = probeResults.shift() ?? null;
      const b: Record<string, unknown> = {};
      b.from = () => b;
      b.where = () => b;
      b.then = (resolve: (v: unknown[]) => unknown) => resolve([{ min }]);
      return b;
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

/** Feed the five probes, in SCHEDULE_SOURCES order. */
function armProbes(...values: Array<Date | null>) {
  probeResults.length = 0;
  probeResults.push(...values);
}

const NOW = 10 * FLOOR_INTERVAL_MS;
const at = (ms: number) => new Date(ms);

beforeEach(() => {
  reported.length = 0;
  probeResults.length = 0;
});

describe('publishNextDue', () => {
  it('publishes the earliest armed due time and reports no stall when everything is fresh', async () => {
    const { kv, store } = fakeKv();
    armProbes(at(NOW + 60_000), null, at(NOW + 30_000), null, null);
    const result = await publishNextDue(envWith(kv), NOW);
    expect(result.earliestMs).toBe(NOW + 30_000);
    expect(result.stall).toBeNull();
    expect(store.get('cron:next-due')).toBe(String(NOW + 30_000));
  });

  it('publishes the "none" sentinel when nothing is armed', async () => {
    const { kv, store } = fakeKv();
    armProbes(null, null, null, null, null);
    await expect(publishNextDue(envWith(kv), NOW)).resolves.toMatchObject({ earliestMs: null, stall: null });
    expect(store.get('cron:next-due')).toBe('none');
  });

  /** A row due 90 seconds ago is a schedule waiting its turn, not a jam. */
  it('does not call a recently-due row stuck', async () => {
    const { kv } = fakeKv();
    armProbes(at(NOW - 90_000), null, null, null, null);
    const result = await publishNextDue(envWith(kv), NOW);
    expect(result.stall).toBeNull();
    expect(reported).toHaveLength(0);
  });

  it('raises a warning and names the jammed tables when a row is overdue past the floor', async () => {
    const { kv } = fakeKv();
    armProbes(null, null, null, at(NOW - 4 * FLOOR_INTERVAL_MS), at(NOW - 2 * FLOOR_INTERVAL_MS));
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

    armProbes(stuck, null, null, null, null);
    await publishNextDue(envWith(kv), NOW);
    expect(reported).toHaveLength(1);

    // Five minutes later — same jam, well inside the raise window.
    armProbes(stuck, null, null, null, null);
    const second = await publishNextDue(envWith(kv), NOW + 300_000);
    expect(second.stall?.firstDetectedMs).toBe(NOW);
    expect(second.stall?.observations).toBe(2);
    expect(reported).toHaveLength(1);

    // Past a full floor interval — raised again so a long jam does not go quiet.
    armProbes(stuck, null, null, null, null);
    const third = await publishNextDue(envWith(kv), NOW + FLOOR_INTERVAL_MS + 1);
    expect(third.stall?.firstDetectedMs).toBe(NOW);
    expect(third.stall?.observations).toBe(3);
    expect(reported).toHaveLength(2);
  });

  /** Clearing is explicit, so the panel goes green the moment the sweeps catch up. */
  it('deletes the stall report once nothing is overdue', async () => {
    const { kv, store } = fakeKv();
    armProbes(at(NOW - 4 * FLOOR_INTERVAL_MS), null, null, null, null);
    await publishNextDue(envWith(kv), NOW);
    expect(store.has('cron:schedule-stall')).toBe(true);

    armProbes(at(NOW + 60_000), null, null, null, null);
    await expect(publishNextDue(envWith(kv), NOW)).resolves.toMatchObject({ stall: null });
    expect(store.has('cron:schedule-stall')).toBe(false);
  });

  it('is a no-op when KV is unbound — the publish exists only to feed the gate', async () => {
    await expect(publishNextDue(envWith(), NOW)).resolves.toEqual({ earliestMs: null, perTable: [], stall: null });
  });
});
