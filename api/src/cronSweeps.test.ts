import { describe, it, expect } from 'vitest';
import { CRON_SWEEPS } from './cronSweeps';
import { CADENCE_BY_CRON, CRON_CADENCES, resolveCronTarget } from './application/runtime/cronSweepRunner';

/**
 * Registry integrity. These are the invariants the two callers (`scheduled()` and
 * POST /api/admin/cron/:target) both depend on; the runner's behaviour itself is
 * tested in application/runtime/cronSweepRunner.test.ts.
 */
describe('CRON_SWEEPS registry', () => {
  it('has no duplicate keys — the key is the log prefix AND the route param', () => {
    const keys = CRON_SWEEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses route-safe, log-safe keys', () => {
    for (const sweep of CRON_SWEEPS) {
      expect(sweep.key, sweep.key).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('declares a known cadence and a description for every sweep', () => {
    for (const sweep of CRON_SWEEPS) {
      expect(CRON_CADENCES, sweep.key).toContain(sweep.cadence);
      expect(sweep.description.length, sweep.key).toBeGreaterThan(10);
    }
  });

  /**
   * A cadence with no sweeps means a declared cron trigger fires and does nothing
   * — the failure mode this registry exists to make impossible.
   */
  it('covers every cadence group, including each declared wrangler cron', () => {
    for (const cadence of CRON_CADENCES) {
      expect(CRON_SWEEPS.filter((s) => s.cadence === cadence).length, cadence).toBeGreaterThan(0);
    }
    for (const cadence of Object.values(CADENCE_BY_CRON)) {
      expect(CRON_SWEEPS.some((s) => s.cadence === cadence), cadence).toBe(true);
    }
  });

  /** No key may shadow a cadence name or `all`, or the route would resolve wrong. */
  it('keeps sweep keys distinct from the group targets', () => {
    const reserved = new Set<string>([...CRON_CADENCES, 'all']);
    for (const sweep of CRON_SWEEPS) {
      expect(reserved.has(sweep.key), sweep.key).toBe(false);
      expect(resolveCronTarget(CRON_SWEEPS, sweep.key)?.kind).toBe('sweep');
    }
  });

  /**
   * The dispatch flag drives the operator confirmation, so the sweeps that spend
   * tokens must carry it. Named explicitly: a new billable sweep that forgets the
   * flag should fail here rather than quietly dispatch on one click.
   */
  it('flags every sweep that can start billable agent runs', () => {
    const dispatching = CRON_SWEEPS.filter((s) => s.dispatches).map((s) => s.key).sort();
    expect(dispatching).toEqual(['auto-exec', 'manager', 'qa-sweep', 'security', 'validator']);
  });

  it('resolves the frequent group to the KV-gated tick sweeps', () => {
    const frequent = resolveCronTarget(CRON_SWEEPS, 'frequent');
    expect(frequent?.kind).toBe('cadence');
    expect(frequent?.sweeps.map((s) => s.key)).toContain('manager');
    expect(frequent?.sweeps.map((s) => s.key)).toContain('auto-exec');
  });
});
