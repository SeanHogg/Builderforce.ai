import { describe, it, expect } from 'vitest';
import { decideRemedyExecution, deferralCeiling, describeTriageDeferral } from './triageStage';

/**
 * These cover the gating bug that made the stuck register inert.
 *
 * On the scheduled (cron) path `ownsDispatch` is false, because the autonomous executor
 * is the single dispatcher for runnable work. That flag used to be folded into ONE
 * `mayStartRun` boolean handed to every remedy, so `reset_breaker`, `drive_signoff` and
 * `resolve_conflict` — none of which the executor ever performs — returned `nothing` on
 * every scheduled pass. An un-run remedy is correctly not counted as an attempt, so
 * those tickets never advanced toward the escalation ceiling either: measured on
 * project 11, 8 of 13 register rows sat at attempts=0 for 24+ days.
 */

const plan = (over: Partial<Parameters<typeof decideRemedyExecution>[0]> = {}) =>
  decideRemedyExecution({
    remedy: 'drive_signoff',
    actionable: true,
    alreadyConducted: false,
    ownsDispatch: false,
    budgetLeft: true,
    ...over,
  });

describe('decideRemedyExecution — manager-owned recoveries on the cron path', () => {
  for (const remedy of ['reset_breaker', 'drive_signoff', 'resolve_conflict'] as const) {
    it(`runs ${remedy} even when the executor owns dispatch`, () => {
      const p = plan({ remedy, ownsDispatch: false });
      expect(p.act).toBe(true);
      expect(p.mayStartRun).toBe(true);
      expect(p.deferred).toBe(false);
    });
  }

  /**
   * `dispatch` used to be deferred on the cron path, on the rule that the executor owns
   * it. But a ticket only reaches the `never_started` diagnosis after a full day of being
   * eligible and untouched, by which point the five-minute executor has had ~288 chances
   * and taken none — so the deferral was unbounded, uncounted, and therefore unescalatable.
   * Measured on project 11: 110 tickets `never_started`, the oldest idle 29 days.
   */
  it('starts a never-run ticket itself rather than deferring to an executor that had a day', () => {
    const p = plan({ remedy: 'dispatch', ownsDispatch: false });
    expect(p).toMatchObject({ act: true, mayStartRun: true, deferred: false });
  });

  it('dispatches when this pass DOES own dispatch', () => {
    const p = plan({ remedy: 'dispatch', ownsDispatch: true });
    expect(p).toMatchObject({ act: true, mayStartRun: true, deferred: false });
  });

  // The ceiling is what keeps the line above from becoming a retry storm: the manager may
  // now start plain work, but never more of it than the shared per-tick budget allows.
  it('still defers plain dispatch when the billable-run budget is spent', () => {
    expect(plan({ remedy: 'dispatch', ownsDispatch: false, budgetLeft: false }))
      .toMatchObject({ act: false, deferred: true });
  });
});

describe('decideRemedyExecution — the billable-run ceiling', () => {
  it('defers every run-starting remedy once the budget is spent', () => {
    for (const remedy of ['dispatch', 'reset_breaker', 'drive_signoff', 'resolve_conflict'] as const) {
      const p = plan({ remedy, budgetLeft: false, ownsDispatch: true });
      expect(p, remedy).toMatchObject({ act: false, deferred: true });
    }
  });

  it('never defers a remedy that starts no run — it just runs', () => {
    for (const remedy of ['assign', 'coordinate', 'return_to_implementation', 'reconcile_pr'] as const) {
      const p = plan({ remedy, budgetLeft: false, ownsDispatch: false });
      expect(p, remedy).toMatchObject({ act: true, deferred: false, mayStartRun: false });
    }
  });

  it('lets a cost-free remedy take its optional "and start it" step only when nothing else owns dispatch', () => {
    expect(plan({ remedy: 'assign', ownsDispatch: true }).mayRaceExecutor).toBe(true);
    expect(plan({ remedy: 'assign', ownsDispatch: false }).mayRaceExecutor).toBe(false);
    expect(plan({ remedy: 'assign', ownsDispatch: true, budgetLeft: false }).mayRaceExecutor).toBe(false);
  });
});

describe('decideRemedyExecution — when the manager must not act at all', () => {
  it('does nothing for a remedy the manager cannot perform', () => {
    expect(plan({ actionable: false })).toMatchObject({ act: false, deferred: false });
  });

  it('does nothing to a ticket the review stage already conducted this pass', () => {
    expect(plan({ alreadyConducted: true })).toMatchObject({ act: false, deferred: false });
  });

  it('never reports a ticket as BOTH acted on and deferred', () => {
    for (const remedy of ['dispatch', 'drive_signoff', 'assign', 'reconcile_pr'] as const) {
      for (const ownsDispatch of [true, false]) {
        for (const budgetLeft of [true, false]) {
          const p = plan({ remedy, ownsDispatch, budgetLeft });
          expect(p.act && p.deferred, `${remedy}/${ownsDispatch}/${budgetLeft}`).toBe(false);
        }
      }
    }
  });
});

/**
 * WHICH ceiling bit, said out loud.
 *
 * Measured on project 11, 2026-07-31 (api 2026.7.198): seven consecutive passes journalled
 * "1 waiting for the next one (max 10 new runs per pass)" with
 * `{"dispatched":1,"dispatchCap":10}` beside it. One run against a cap of ten did not
 * exhaust the cap — the workspace's 25-runs-per-tick pool was already spent by the
 * autonomous executor (40 runs completed that day) — so the sentence sent a reader to
 * raise a number that had never been reached.
 */
describe('deferralCeiling', () => {
  it('names nothing while both ceilings have room', () => {
    expect(deferralCeiling({ passCapLeft: true, tenantBudgetLeft: true })).toBeNull();
  });

  it('names the WORKSPACE pool when this project still had per-pass room', () => {
    expect(deferralCeiling({ passCapLeft: true, tenantBudgetLeft: false })).toBe('tenant_tick_budget');
  });

  it('names this project\'s per-pass cap when that is the one spent', () => {
    expect(deferralCeiling({ passCapLeft: false, tenantBudgetLeft: true })).toBe('pass_dispatch_cap');
  });

  it('prefers the per-pass cap when BOTH are spent — the project used its own share', () => {
    // Reporting the workspace pool here would send the reader one level too far out, to a
    // ceiling they cannot raise without also raising this project's share.
    expect(deferralCeiling({ passCapLeft: false, tenantBudgetLeft: false })).toBe('pass_dispatch_cap');
  });
});

/**
 * THE SENTENCE THAT CONTRADICTED ITS OWN DETAIL (api 2026.7.200, project 11, 11:45:30Z):
 *
 *   "Unstuck 1 of 2 stalled tickets this pass. Nothing was deferred for want of a run."
 *   {"stalled":2,"unstuck":1,"deferred":1,"deferredReason":null,...}
 *
 * The clause branched on the REASON, and the wall-clock shed — the first deferral site in
 * the loop, and the one actually firing on that board — recorded none. An explanation
 * going missing must degrade to saying less, never to denying the fact.
 */
describe('describeTriageDeferral', () => {
  const caps = { perPass: 10, perTenantTick: 25 };

  it('never claims nothing was deferred while the counter says otherwise', () => {
    const text = describeTriageDeferral(1, null, caps);
    expect(text).toContain('1 waiting for the next one');
    expect(text).not.toContain('Nothing was deferred');
  });

  it('says nothing was deferred only when the COUNT is zero', () => {
    expect(describeTriageDeferral(0, null, caps)).toBe('. Nothing was deferred.');
  });

  it('names the wall clock — the cause the run ceilings could not express', () => {
    expect(describeTriageDeferral(37, 'pass_wall_clock', caps))
      .toContain('37 waiting for the next one because this pass ran out of its wall-clock budget');
  });

  it('names this project\'s per-pass run cap with its actual value', () => {
    expect(describeTriageDeferral(2, 'pass_dispatch_cap', caps)).toContain('10 new runs per pass');
  });

  it('names the WORKSPACE pool, and says who else draws on it', () => {
    const text = describeTriageDeferral(2, 'tenant_tick_budget', caps);
    expect(text).toContain('25 runs for this five-minute tick');
    expect(text).toContain('autonomous executor');
  });
});
