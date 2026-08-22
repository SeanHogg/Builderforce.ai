import { describe, it, expect } from 'vitest';
import {
  classifyDueTime,
  evaluateCronGate,
  floorIntervalMs,
  FLOOR_INTERVAL_MS,
  MAX_FLOOR_INTERVAL_MS,
  MIN_FLOOR_INTERVAL_MS,
  openCronTick,
  readScheduleStall,
  signalPendingWork,
} from './cronWorkSignal';
import type { Env } from '../../env';

/** Minimal in-memory KV double — the gate only uses get/put/delete. */
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

const envWith = (kv?: KVNamespace, over: Partial<Env> = {}): Env =>
  ({ AUTH_CACHE_KV: kv, ...over } as Env);

describe('floorIntervalMs', () => {
  it('defaults to the 30-minute constant when unset', () => {
    expect(floorIntervalMs(envWith())).toBe(FLOOR_INTERVAL_MS);
  });

  it('honours a valid CRON_FLOOR_INTERVAL_MS override', () => {
    expect(floorIntervalMs(envWith(undefined, { CRON_FLOOR_INTERVAL_MS: '600000' }))).toBe(600_000);
  });

  /** The floor must never fall below the tick itself, or the gate stops gating. */
  it('clamps an override that is too short or too long', () => {
    expect(floorIntervalMs(envWith(undefined, { CRON_FLOOR_INTERVAL_MS: '1000' }))).toBe(MIN_FLOOR_INTERVAL_MS);
    expect(floorIntervalMs(envWith(undefined, { CRON_FLOOR_INTERVAL_MS: '99999999' }))).toBe(MAX_FLOOR_INTERVAL_MS);
  });

  /** A mistyped var must never be able to break the cron path. */
  it('falls back to the default on a non-numeric or zero value', () => {
    expect(floorIntervalMs(envWith(undefined, { CRON_FLOOR_INTERVAL_MS: 'thirty minutes' }))).toBe(FLOOR_INTERVAL_MS);
    expect(floorIntervalMs(envWith(undefined, { CRON_FLOOR_INTERVAL_MS: '0' }))).toBe(FLOOR_INTERVAL_MS);
  });
});

describe('evaluateCronGate', () => {
  it('fails OPEN when KV is unbound — the gate may slow a tick, never hide work', async () => {
    const decision = await evaluateCronGate(envWith(), 1_000);
    expect(decision).toMatchObject({ run: true, reason: 'kv-unavailable', floorDue: true });
  });

  it('runs on a pending-work signal', async () => {
    const { kv } = fakeKv({ 'cron:work-pending': '1', 'cron:last-floor-sweep': '1000' });
    const decision = await evaluateCronGate(envWith(kv), 1_000 + 60_000);
    expect(decision.run).toBe(true);
    expect(decision.reason).toBe('signal');
    expect(decision.floorDue).toBe(false);
  });

  it('skips when nothing signalled and the floor is not due', async () => {
    const { kv } = fakeKv({ 'cron:last-floor-sweep': '1000' });
    const decision = await evaluateCronGate(envWith(kv), 1_000 + 60_000);
    expect(decision).toMatchObject({ run: false, reason: 'idle', floorDue: false, lastFloorMs: 1_000 });
  });

  it('runs on the floor once the interval has elapsed', async () => {
    const { kv } = fakeKv({ 'cron:last-floor-sweep': '1000' });
    const decision = await evaluateCronGate(envWith(kv), 1_000 + FLOOR_INTERVAL_MS);
    expect(decision).toMatchObject({ run: true, reason: 'floor', floorDue: true });
  });

  /** The override is the whole point of the env var: a tighter floor wakes sooner. */
  it('uses the override rather than the constant to decide the floor', async () => {
    const { kv } = fakeKv({ 'cron:last-floor-sweep': '1000' });
    const env = envWith(kv, { CRON_FLOOR_INTERVAL_MS: String(MIN_FLOOR_INTERVAL_MS) });
    const nowJustPastOverride = 1_000 + MIN_FLOOR_INTERVAL_MS;
    const decision = await evaluateCronGate(env, nowJustPastOverride);
    expect(decision).toMatchObject({ run: true, reason: 'floor', floorIntervalMs: MIN_FLOOR_INTERVAL_MS });
    // The default constant would still have skipped at this instant.
    await expect(evaluateCronGate(envWith(kv), nowJustPastOverride)).resolves.toMatchObject({ run: false });
  });

  /** A never-stamped floor reads as "immediately due" at any real wall-clock time. */
  it('reports lastFloorMs as null and runs the floor when never stamped', async () => {
    const { kv } = fakeKv();
    const decision = await evaluateCronGate(envWith(kv), Date.parse('2026-07-26T12:00:00Z'));
    expect(decision).toMatchObject({ run: true, reason: 'floor', floorDue: true, lastFloorMs: null });
  });

  /** Inspecting the gate (e.g. from the admin panel) must not consume the signal. */
  it('is read-only — evaluating twice does not clear the signal', async () => {
    const { kv, store } = fakeKv({ 'cron:work-pending': '1' });
    await evaluateCronGate(envWith(kv), 1_000);
    await evaluateCronGate(envWith(kv), 1_000);
    expect(store.get('cron:work-pending')).toBe('1');
  });
});

describe('openCronTick', () => {
  it('consumes the signal and stamps the floor when the floor is due', async () => {
    const { kv, store } = fakeKv({ 'cron:work-pending': '1' });
    await openCronTick(envWith(kv), 4_242, true);
    expect(store.has('cron:work-pending')).toBe(false);
    expect(store.get('cron:last-floor-sweep')).toBe('4242');
  });

  it('leaves the floor timestamp alone when this run does not satisfy the floor', async () => {
    const { kv, store } = fakeKv({ 'cron:work-pending': '1', 'cron:last-floor-sweep': '1000' });
    await openCronTick(envWith(kv), 4_242, false);
    expect(store.get('cron:last-floor-sweep')).toBe('1000');
  });
});

describe('signalPendingWork', () => {
  it('arms the gate so the next tick runs', async () => {
    const { kv } = fakeKv({ 'cron:last-floor-sweep': '1000' });
    const env = envWith(kv);
    await expect(evaluateCronGate(env, 1_000 + 60_000)).resolves.toMatchObject({ run: false });
    await signalPendingWork(env);
    await expect(evaluateCronGate(env, 1_000 + 60_000)).resolves.toMatchObject({ run: true, reason: 'signal' });
  });

  it('is a no-op (not a throw) when KV is unbound', async () => {
    await expect(signalPendingWork(envWith())).resolves.toBeUndefined();
  });
});

/**
 * The next-due gate. The work-pending signal only covers WRITE-driven work; a schedule
 * that merely comes due signals nothing, so before this branch a 09:00 report could
 * only fire on the floor sweep and ran up to a full floor interval late.
 */
describe('evaluateCronGate — dynamic next-due', () => {
  const FLOOR = FLOOR_INTERVAL_MS;

  it('runs when a schedule has come due, even though nothing signalled and the floor is not', async () => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({
      'cron:last-floor-sweep': String(now - 60_000), // floor NOT due
      'cron:next-due': String(now - 1_000),          // a schedule just came due
    });
    const decision = await evaluateCronGate(envWith(kv), now);
    expect(decision).toMatchObject({ run: true, reason: 'due', floorDue: false });
  });

  it('stays idle while the next due time is still in the future', async () => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({
      'cron:last-floor-sweep': String(now - 60_000),
      'cron:next-due': String(now + 120_000),
    });
    const decision = await evaluateCronGate(envWith(kv), now);
    expect(decision).toMatchObject({ run: false, reason: 'idle' });
    expect(decision.nextDueMs).toBe(now + 120_000);
  });

  /**
   * The bound that protects autosuspend. A row whose sweep never re-arms it (the sweep
   * switched off in cron controls, a generator erroring past its retries) stays due
   * forever — unbounded, this branch would then open on EVERY tick and quietly undo the
   * whole point of the gate.
   */
  it('ignores a due time older than one floor interval so a stuck schedule cannot pin the gate open', async () => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({
      'cron:last-floor-sweep': String(now - 60_000), // floor NOT due
      'cron:next-due': String(now - FLOOR - 1),      // stuck: due, but long past
    });
    const decision = await evaluateCronGate(envWith(kv), now);
    expect(decision).toMatchObject({ run: false, reason: 'idle' });
  });

  /** A stuck schedule still RUNS — just on the floor, exactly as it did pre-gate. */
  it('still runs a long-overdue schedule once the floor comes due', async () => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({
      'cron:last-floor-sweep': String(now - FLOOR - 1), // floor IS due
      'cron:next-due': String(now - FLOOR - 1),
    });
    const decision = await evaluateCronGate(envWith(kv), now);
    expect(decision).toMatchObject({ run: true, reason: 'floor' });
  });

  /** "Nothing armed" and "never published" must both degrade to floor-only behaviour. */
  it.each([['none'], ['not-a-number'], ['0']])('treats %s as no known due time', async (raw) => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({ 'cron:last-floor-sweep': String(now - 60_000), 'cron:next-due': raw });
    const decision = await evaluateCronGate(envWith(kv), now);
    expect(decision).toMatchObject({ run: false, reason: 'idle', nextDueMs: null });
  });

  /** A signal outranks a due time — both mean "run", but the reason must stay honest. */
  it('reports the signal as the reason when both a signal and a due time are present', async () => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({
      'cron:work-pending': '1',
      'cron:last-floor-sweep': String(now - 60_000),
      'cron:next-due': String(now - 1_000),
    });
    expect(await evaluateCronGate(envWith(kv), now)).toMatchObject({ run: true, reason: 'signal' });
  });
});

/**
 * The other half of the bounded `due` window. The gate correctly declines to re-open
 * on an ancient due time — but declining is not noticing, and before this a jammed
 * schedule was indistinguishable from an idle platform: both read "nothing due".
 */
describe('classifyDueTime', () => {
  const FLOOR = FLOOR_INTERVAL_MS;

  it('names the four states the gate and the diagnostic both branch on', () => {
    expect(classifyDueTime(null, 1_000, FLOOR)).toBe('none');
    expect(classifyDueTime(2_000, 1_000, FLOOR)).toBe('future');
    expect(classifyDueTime(1_000, 1_000, FLOOR)).toBe('due');
    expect(classifyDueTime(1_000, 1_000 + FLOOR + 1, FLOOR)).toBe('stuck');
  });

  /** Exactly one interval overdue is still DUE — the boundary belongs to the run side,
   *  so a schedule is never declared jammed while the gate would still act on it. */
  it('puts the boundary itself on the due side', () => {
    expect(classifyDueTime(1_000, 1_000 + FLOOR, FLOOR)).toBe('due');
  });
});

describe('evaluateCronGate — dueState', () => {
  const FLOOR = FLOOR_INTERVAL_MS;

  it('reports a stuck due time even while the gate correctly idles on it', async () => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({
      'cron:last-floor-sweep': String(now - 60_000),
      'cron:next-due': String(now - FLOOR - 1),
    });
    const decision = await evaluateCronGate(envWith(kv), now);
    expect(decision).toMatchObject({ run: false, reason: 'idle', dueState: 'stuck' });
  });

  it('reports dueState alongside every other reason', async () => {
    const now = 10 * FLOOR;
    const { kv } = fakeKv({ 'cron:last-floor-sweep': String(now - 60_000), 'cron:next-due': String(now + 60_000) });
    expect(await evaluateCronGate(envWith(kv), now)).toMatchObject({ reason: 'idle', dueState: 'future' });
    expect(await evaluateCronGate(envWith(), now)).toMatchObject({ reason: 'kv-unavailable', dueState: 'none' });
  });
});

describe('readScheduleStall', () => {
  it('returns null when nothing is stored, KV is unbound, or the value is corrupt', async () => {
    await expect(readScheduleStall(envWith())).resolves.toBeNull();
    await expect(readScheduleStall(envWith(fakeKv().kv))).resolves.toBeNull();
    await expect(readScheduleStall(envWith(fakeKv({ 'cron:schedule-stall': '{oops' }).kv))).resolves.toBeNull();
  });

  /** An empty `tables` array is not a stall — it must not light the panel up. */
  it('treats a report with no tables as no stall', async () => {
    const { kv } = fakeKv({ 'cron:schedule-stall': JSON.stringify({ firstDetectedMs: 1, tables: [] }) });
    await expect(readScheduleStall(envWith(kv))).resolves.toBeNull();
  });

  it('reads back a stored report', async () => {
    const report = {
      firstDetectedMs: 1_000, observedMs: 2_000, observations: 3, lastRaisedMs: 1_000,
      tables: [{ table: 'report_schedules', dueAtMs: 500, overdueMs: 1_500 }],
    };
    const { kv } = fakeKv({ 'cron:schedule-stall': JSON.stringify(report) });
    await expect(readScheduleStall(envWith(kv))).resolves.toEqual(report);
  });
});
