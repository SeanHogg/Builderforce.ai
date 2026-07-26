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

  it('still leaves plain dispatch to the executor, and says so by deferring', () => {
    const p = plan({ remedy: 'dispatch', ownsDispatch: false });
    expect(p.act).toBe(false);
    expect(p.deferred).toBe(true);
  });

  it('dispatches when this pass DOES own dispatch', () => {
    const p = plan({ remedy: 'dispatch', ownsDispatch: true });
    expect(p).toMatchObject({ act: true, mayStartRun: true, deferred: false });
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
