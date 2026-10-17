import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  cadenceForCron,
  clampForceTimeout,
  DEFAULT_FORCE_TIMEOUT_MS,
  dispatchCronSweeps,
  MAX_FORCE_TIMEOUT_MS,
  resolveCronTarget,
  runCronSweeps,
  sweepsForCadence,
  validateSweepOrdering,
  type CronSweepContext,
  type CronSweepDef,
} from './cronSweepRunner';
import { createTickDispatchBudget } from './tickDispatchBudget';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

const ctx = (env: Partial<Env> = {}): CronSweepContext => ({
  env: env as Env,
  db: {} as Db,
  budget: createTickDispatchBudget(),
});

function sweep(over: Partial<CronSweepDef> & { key: string }): CronSweepDef {
  return {
    cadence: 'frequent',
    description: 'test sweep',
    run: async () => null,
    ...over,
  };
}

describe('cadenceForCron', () => {
  it('maps the declared wrangler cron expressions to their groups', () => {
    expect(cadenceForCron('0 9 * * *')).toBe('daily');
    expect(cadenceForCron('0 8 * * 1')).toBe('weekly-mon');
    expect(cadenceForCron('0 16 * * 5')).toBe('weekly-fri');
  });

  /**
   * scheduled() used to select the frequent branch by EXCLUDING the three known
   * expressions, so anything else — including a manual `wrangler` invocation with
   * no cron string — is the frequent tick. That fallback must survive.
   */
  it('treats an unknown or absent cron as the frequent tick', () => {
    expect(cadenceForCron('*/5 * * * *')).toBe('frequent');
    expect(cadenceForCron(undefined)).toBe('frequent');
    expect(cadenceForCron('')).toBe('frequent');
  });
});

describe('resolveCronTarget', () => {
  const defs = [
    sweep({ key: 'manager', cadence: 'frequent' }),
    sweep({ key: 'auto-exec', cadence: 'frequent' }),
    sweep({ key: 'retention', cadence: 'daily' }),
  ];

  it('resolves a single sweep key', () => {
    const r = resolveCronTarget(defs, 'manager');
    expect(r?.kind).toBe('sweep');
    expect(r?.sweeps.map((s) => s.key)).toEqual(['manager']);
  });

  it('resolves a cadence group', () => {
    const r = resolveCronTarget(defs, 'frequent');
    expect(r?.kind).toBe('cadence');
    expect(r?.sweeps.map((s) => s.key)).toEqual(['manager', 'auto-exec']);
  });

  it('resolves `all` to every registered sweep', () => {
    expect(resolveCronTarget(defs, 'all')?.sweeps).toHaveLength(3);
  });

  /** An unknown target must 404, not silently run nothing. */
  it('returns null for an unknown or empty target', () => {
    expect(resolveCronTarget(defs, 'nope')).toBeNull();
    expect(resolveCronTarget(defs, '')).toBeNull();
  });

  it('returns an empty sweep list for a cadence with no registered sweeps', () => {
    const r = resolveCronTarget(defs, 'weekly-fri');
    expect(r?.kind).toBe('cadence');
    expect(r?.sweeps).toEqual([]);
  });
});

describe('sweepsForCadence', () => {
  it('preserves registry order within a cadence', () => {
    const defs = [
      sweep({ key: 'a', cadence: 'frequent' }),
      sweep({ key: 'b', cadence: 'daily' }),
      sweep({ key: 'c', cadence: 'frequent' }),
    ];
    expect(sweepsForCadence(defs, 'frequent').map((s) => s.key)).toEqual(['a', 'c']);
  });
});

describe('clampForceTimeout', () => {
  it('defaults on a missing or nonsense value', () => {
    expect(clampForceTimeout(undefined)).toBe(DEFAULT_FORCE_TIMEOUT_MS);
    expect(clampForceTimeout('abc')).toBe(DEFAULT_FORCE_TIMEOUT_MS);
    expect(clampForceTimeout(-5)).toBe(DEFAULT_FORCE_TIMEOUT_MS);
  });

  it('clamps to a range a request can survive', () => {
    expect(clampForceTimeout(10)).toBe(1_000);
    expect(clampForceTimeout(999_999)).toBe(MAX_FORCE_TIMEOUT_MS);
    expect(clampForceTimeout(5_000)).toBe(5_000);
  });
});

describe('runCronSweeps', () => {
  it('returns one outcome per sweep with its summary', async () => {
    const results = await runCronSweeps([
      sweep({ key: 'loud', run: async () => 'dispatched=2' }),
      sweep({ key: 'quiet', run: async () => null }),
    ], ctx());
    expect(results.map((r) => [r.key, r.ok, r.summary])).toEqual([
      ['loud', true, 'dispatched=2'],
      ['quiet', true, null],
    ]);
  });

  /**
   * The isolation the per-branch waitUntil used to provide: one sweep throwing
   * must not stop its siblings, and must surface as data rather than a rejection.
   */
  it('isolates a throwing sweep from the others', async () => {
    const results = await runCronSweeps([
      sweep({ key: 'boom', run: async () => { throw new Error('neon down'); } }),
      sweep({ key: 'fine', run: async () => 'ok=1' }),
    ], ctx());
    expect(results[0]).toMatchObject({ key: 'boom', ok: false, error: 'neon down' });
    expect(results[1]).toMatchObject({ key: 'fine', ok: true, summary: 'ok=1' });
  });

  it('skips a sweep its environment disables, without invoking it', async () => {
    const run = vi.fn(async () => 'should not run');
    const results = await runCronSweeps([
      sweep({ key: 'demo-reseed', available: () => false, run }),
    ], ctx());
    expect(run).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ key: 'demo-reseed', skipped: true, ok: true });
  });

  it('honours an available() that passes', async () => {
    const results = await runCronSweeps([
      sweep({ key: 'demo-reseed', available: (env) => Boolean(env.DEMO_ACCOUNTS_ENABLED), run: async () => 'personas=5' }),
    ], ctx({ DEMO_ACCOUNTS_ENABLED: 'true' }));
    expect(results[0]!.skipped).toBeUndefined();
    expect(results[0]!.summary).toBe('personas=5');
  });

  it('shares ONE dispatch budget across every sweep in the run', async () => {
    const shared = ctx();
    await runCronSweeps([
      sweep({ key: 'a', run: async ({ budget }) => { budget.tryReserve(7); return null; } }),
      sweep({ key: 'b', run: async ({ budget }) => { budget.tryReserve(7); return null; } }),
    ], shared);
    expect(shared.budget.reserved(7)).toBe(2);
  });

  describe('deadlines', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    /**
     * A forced run must always answer, and must NEVER cancel the sweep it was run
     * to observe: the still-running promise goes to keepAlive (the request's
     * waitUntil) so the work completes after the response.
     */
    it('reports a slow sweep as timedOut and hands it to keepAlive', async () => {
      let finish: (v: string) => void = () => {};
      const kept: Array<Promise<unknown>> = [];
      const pending = runCronSweeps(
        [sweep({ key: 'manager', run: () => new Promise<string>((res) => { finish = res; }) })],
        ctx(),
        { timeoutMs: 1_000, keepAlive: (p) => { kept.push(p); } },
      );
      await vi.advanceTimersByTimeAsync(1_001);
      const results = await pending;
      expect(results[0]).toMatchObject({ key: 'manager', timedOut: true, ok: true });
      expect(kept).toHaveLength(1);

      // The sweep was not aborted — completing it still resolves its outcome.
      finish('managed=3');
      await expect(kept[0]!).resolves.toMatchObject({ summary: 'managed=3' });
    });

    it('does not time out a sweep that finishes inside the deadline', async () => {
      const pending = runCronSweeps(
        [sweep({ key: 'fast', run: async () => 'done=1' })],
        ctx(),
        { timeoutMs: 5_000 },
      );
      await vi.advanceTimersByTimeAsync(1);
      const results = await pending;
      expect(results[0]!.timedOut).toBeUndefined();
      expect(results[0]!.summary).toBe('done=1');
    });
  });
});

describe('dispatchCronSweeps', () => {
  it('hands every unchained sweep to waitUntil independently', async () => {
    const kept: Array<Promise<unknown>> = [];
    const ran: string[] = [];
    dispatchCronSweeps([
      sweep({ key: 'a', run: async () => { ran.push('a'); return null; } }),
      sweep({ key: 'b', run: async () => { ran.push('b'); throw new Error('nope'); } }),
    ], ctx(), (p) => { kept.push(p); });
    expect(kept).toHaveLength(2);
    // A failing sweep's branch still resolves — a rejected waitUntil promise
    // would surface as an unhandled cron failure.
    await expect(Promise.all(kept)).resolves.toBeDefined();
    expect(ran.sort()).toEqual(['a', 'b']);
  });
});

/** A promise the test settles by hand, to observe what has started meanwhile. */
function gate<T = string | null>() {
  let release: (v: T) => void = () => {};
  const promise = new Promise<T>((res) => { release = res; });
  return { promise, release };
}

describe('declared ordering (`after`)', () => {
  it('groups a chain into ONE waitUntil and starts each step only after the previous settles', async () => {
    const kept: Array<Promise<unknown>> = [];
    const started: string[] = [];
    const retention = gate();
    dispatchCronSweeps([
      sweep({ key: 'retention', cadence: 'daily', run: () => { started.push('retention'); return retention.promise; } }),
      sweep({ key: 'db-vacuum', cadence: 'daily', after: 'retention', run: async () => { started.push('db-vacuum'); return null; } }),
      sweep({ key: 'db-pressure', cadence: 'daily', after: 'db-vacuum', run: async () => { started.push('db-pressure'); return null; } }),
      sweep({ key: 'llm-health', cadence: 'daily', run: async () => { started.push('llm-health'); return null; } }),
    ], ctx(), (p) => { kept.push(p); });

    // Two chains: retention → db-vacuum → db-pressure, and llm-health on its own.
    expect(kept).toHaveLength(2);
    await Promise.resolve();
    expect([...started].sort()).toEqual(['llm-health', 'retention']);

    retention.release(null);
    await Promise.all(kept);
    expect(started.slice(2)).toEqual(['db-vacuum', 'db-pressure']);
  });

  it('runs a later step after a FAILED predecessor by default', async () => {
    const ran: string[] = [];
    const results = await runCronSweeps([
      sweep({ key: 'retention', cadence: 'daily', run: async () => { ran.push('retention'); throw new Error('neon down'); } }),
      sweep({ key: 'db-vacuum', cadence: 'daily', after: 'retention', run: async () => { ran.push('db-vacuum'); return null; } }),
    ], ctx());
    expect(ran).toEqual(['retention', 'db-vacuum']);
    expect(results.map((r) => [r.key, r.ok])).toEqual([['retention', false], ['db-vacuum', true]]);
  });

  it('skips a skipIfAfterFailed step when its predecessor threw, and names the predecessor', async () => {
    const rent = vi.fn(async () => 'charged=3');
    const results = await runCronSweeps([
      sweep({ key: 'phone-allowance-grant', cadence: 'daily', run: async () => { throw new Error('ledger down'); } }),
      sweep({ key: 'phone-number-rent', cadence: 'daily', after: 'phone-allowance-grant', skipIfAfterFailed: true, run: rent }),
    ], ctx());
    expect(rent).not.toHaveBeenCalled();
    expect(results[1]).toMatchObject({ key: 'phone-number-rent', ok: true, skipped: true, blockedBy: 'phone-allowance-grant' });
  });

  it('still runs a skipIfAfterFailed step after a predecessor that was merely unavailable', async () => {
    const rent = vi.fn(async () => 'charged=3');
    await runCronSweeps([
      sweep({ key: 'phone-allowance-grant', cadence: 'daily', available: () => false }),
      sweep({ key: 'phone-number-rent', cadence: 'daily', after: 'phone-allowance-grant', skipIfAfterFailed: true, run: rent }),
    ], ctx());
    expect(rent).toHaveBeenCalledTimes(1);
  });

  it('lets siblings under one predecessor run concurrently once it settles', async () => {
    const kept: Array<Promise<unknown>> = [];
    const started: string[] = [];
    const vacuum = gate();
    dispatchCronSweeps([
      sweep({ key: 'retention', cadence: 'daily', run: async () => null }),
      sweep({ key: 'db-vacuum', cadence: 'daily', after: 'retention', run: () => { started.push('db-vacuum'); return vacuum.promise; } }),
      sweep({ key: 'replay-rollup', cadence: 'daily', after: 'retention', run: async () => { started.push('replay-rollup'); return null; } }),
    ], ctx(), (p) => { kept.push(p); });
    expect(kept).toHaveLength(1);
    // replay-rollup starts while db-vacuum is still held open.
    await vi.waitFor(() => expect([...started].sort()).toEqual(['db-vacuum', 'replay-rollup']));
    vacuum.release(null);
    await Promise.all(kept);
  });

  /** POST /api/admin/cron/<key> must still run exactly that sweep. */
  it('runs a chained sweep on its own when its predecessor is not part of the run', async () => {
    const results = await runCronSweeps([
      sweep({ key: 'db-pressure', cadence: 'daily', after: 'db-vacuum', run: async () => 'ok=1' }),
    ], ctx());
    expect(results).toEqual([expect.objectContaining({ key: 'db-pressure', ok: true, summary: 'ok=1' })]);
  });

  it('degrades a cyclic declaration to unordered rather than deadlocking the tick', async () => {
    const results = await runCronSweeps([
      sweep({ key: 'a', after: 'b', run: async () => 'a' }),
      sweep({ key: 'b', after: 'a', run: async () => 'b' }),
    ], ctx());
    expect(results.map((r) => r.summary)).toEqual(['a', 'b']);
  });
});

describe('validateSweepOrdering', () => {
  it('accepts unchained sweeps and a valid same-cadence chain', () => {
    expect(validateSweepOrdering([
      sweep({ key: 'retention', cadence: 'daily' }),
      sweep({ key: 'db-vacuum', cadence: 'daily', after: 'retention' }),
      sweep({ key: 'manager' }),
    ])).toEqual([]);
  });

  it('rejects an unknown target, a self reference and a cross-cadence wait', () => {
    const errors = validateSweepOrdering([
      sweep({ key: 'retention', cadence: 'daily' }),
      sweep({ key: 'ghost', cadence: 'daily', after: 'nope' }),
      sweep({ key: 'self', cadence: 'daily', after: 'self' }),
      sweep({ key: 'manager', cadence: 'frequent', after: 'retention' }),
    ]);
    expect(errors).toHaveLength(3);
    const all = errors.join(' | ');
    expect(all).toMatch(/ghost: .*unknown sweep 'nope'/);
    expect(all).toMatch(/self: .*names itself/);
    expect(all).toMatch(/manager: .*daily, not frequent/);
  });

  it('rejects a cycle', () => {
    const errors = validateSweepOrdering([
      sweep({ key: 'a', after: 'c' }),
      sweep({ key: 'b', after: 'a' }),
      sweep({ key: 'c', after: 'b' }),
    ]);
    expect(errors.some((e) => /cycle/.test(e))).toBe(true);
  });

  it('rejects skipIfAfterFailed without an `after`', () => {
    expect(validateSweepOrdering([sweep({ key: 'rent', skipIfAfterFailed: true })])).toHaveLength(1);
  });
});
