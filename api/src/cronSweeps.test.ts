import { describe, it, expect } from 'vitest';
import { CRON_SWEEPS } from './cronSweeps';
import { CADENCE_BY_CRON, CRON_CADENCES, resolveCronTarget, validateSweepOrdering } from './application/runtime/cronSweepRunner';

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
    expect(dispatching).toEqual([
      // `agent-benchmark` runs each workspace's fixed benchmark set on the tenant's own
      // plan, so it is billable and declares the flag — listed here as the deliberate
      // decision this assertion exists to force.
      'agent-benchmark', 'auto-exec', 'mailbox-automation', 'manager', 'pr-merge', 'qa-sweep',
      'security', 'validator',
    ]);
  });

  /** PRD 33 §5.2: the weekly floor of the page review's captures (a new release captures on first sight). */
  it('registers the weekly replay-page-captures sweep, non-dispatching (runner jobs, no agent runs)', () => {
    const sweep = CRON_SWEEPS.find((s) => s.key === 'replay-page-captures');
    expect(sweep?.cadence).toBe('weekly-mon');
    expect(sweep?.dispatches).toBeFalsy();
  });

  /** PRD 33 §5.3.2: window-end proof verdicts are written by the daily runner, after the replay rollup. */
  it('registers the daily proof-verdicts sweep chained after replay-rollup, as a non-dispatching sweep', () => {
    const sweep = CRON_SWEEPS.find((s) => s.key === 'proof-verdicts');
    expect(sweep?.cadence).toBe('daily');
    expect(sweep?.dispatches).toBeFalsy();
    expect(sweep?.after).toBe('replay-rollup');
  });

  /** PRD 33 §5.1: the prescription rules read what the rollup and the proof verdicts just wrote. */
  it('registers the daily replay-prescriptions sweep chained after proof-verdicts (itself after replay-rollup), non-dispatching', () => {
    const sweep = CRON_SWEEPS.find((s) => s.key === 'replay-prescriptions');
    expect(sweep?.cadence).toBe('daily');
    expect(sweep?.dispatches).toBeFalsy();
    expect(sweep?.after).toBe('proof-verdicts');
  });

  /**
   * Every `after` must name a real, same-cadence sweep and the chains must be acyclic.
   * The runner degrades an invalid declaration to "unordered" rather than wedging a
   * tick, so this assertion is the only thing that makes a typo fail loudly.
   */
  it('declares a valid ordering graph', () => {
    expect(validateSweepOrdering(CRON_SWEEPS)).toEqual([]);
  });

  /**
   * The orderings the registry's comments call load-bearing. Position in the list used
   * to be described as the ordering while every sweep actually ran concurrently, so
   * each one is pinned here as a declaration rather than an index comparison.
   */
  it('chains every ordering the sweeps depend on', () => {
    const afterOf = (key: string) => CRON_SWEEPS.find((s) => s.key === key)?.after;
    expect(afterOf('metric-rollups')).toBe('object-registry');
    expect(afterOf('canvas-triggers')).toBe('metric-rollups');
    expect(afterOf('db-vacuum')).toBe('retention');
    expect(afterOf('db-pressure')).toBe('db-vacuum');
    expect(afterOf('replay-rollup')).toBe('retention');
    expect(afterOf('proof-verdicts')).toBe('replay-rollup');
    expect(afterOf('replay-prescriptions')).toBe('proof-verdicts');
    expect(afterOf('phone-number-rent')).toBe('phone-allowance-grant');
  });

  /** Rent charged against an allowance the grant failed to top up suspends a paid-up number. */
  it('skips phone rent when the allowance grant it waits on threw — and only that sweep opts in', () => {
    const optedIn = CRON_SWEEPS.filter((s) => s.skipIfAfterFailed).map((s) => s.key);
    expect(optedIn).toEqual(['phone-number-rent']);
  });

  it('resolves the frequent group to the KV-gated tick sweeps', () => {
    const frequent = resolveCronTarget(CRON_SWEEPS, 'frequent');
    expect(frequent?.kind).toBe('cadence');
    expect(frequent?.sweeps.map((s) => s.key)).toContain('manager');
    expect(frequent?.sweeps.map((s) => s.key)).toContain('auto-exec');
  });
});
