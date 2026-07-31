import { describe, it, expect } from 'vitest';
import { decideRemedyExecution } from './triageStage';

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
  for (const remedy of ['reset_breaker', 'drive_signoff', 'resolve_conflict']) {
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
    for (const remedy of ['dispatch', 'reset_breaker', 'drive_signoff', 'resolve_conflict']) {
      const p = plan({ remedy, budgetLeft: false, ownsDispatch: true });
      expect(p, remedy).toMatchObject({ act: false, deferred: true });
    }
  });

  it('never defers a remedy that starts no run — it just runs', () => {
    for (const remedy of ['assign', 'coordinate', 'return_to_implementation', 'reconcile_pr']) {
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
    for (const remedy of ['dispatch', 'drive_signoff', 'assign', 'reconcile_pr']) {
      for (const ownsDispatch of [true, false]) {
        for (const budgetLeft of [true, false]) {
          const p = plan({ remedy, ownsDispatch, budgetLeft });
          expect(p.act && p.deferred, `${remedy}/${ownsDispatch}/${budgetLeft}`).toBe(false);
        }
      }
    }
  });
});
