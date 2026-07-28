import { describe, it, expect } from 'vitest';
import {
  MAX_CONSECUTIVE_YIELDS, ROTATABLE_STAGES, carryOverRotation, decideRotation,
} from './passRotation';

/**
 * THE STARVATION THE RESERVE COULD NOT FIX.
 *
 * `MANAGER_TRIAGE_RESERVE_MS` stops the discretionary stages at 14s of a 20s pass so
 * triage — which owns EVERY remedy — always has 6s. It did not hold, because a
 * reservation checked only BETWEEN units cannot refuse an oversized one. Measured on
 * project 11, 2026-07-28: the pass reached triage at `elapsedMs: 27648` against
 * `budgetMs: 20000`, having spent 16.4s inside a single PR iteration that hit a conflict
 * and dispatched a recovery run. Result: `Stall triage skipped this pass` on repeat, every
 * stuck-register row's `lastAttempt` seven hours stale against a five-minute cadence, and
 * 678 stalled tickets whose remedies went unattempted throughout.
 *
 * The rotation makes the guarantee structural instead of arithmetic: a pass remembers what
 * it starved and the next pass runs only that. It needs no estimate of a unit's cost,
 * which is the whole point — the cost is set by a provider, not by this codebase.
 */
describe('decideRotation', () => {
  it('runs everything when nothing was starved', () => {
    const r = decideRotation(null);
    expect(r.yieldTo.size).toBe(0);
    for (const stage of ROTATABLE_STAGES) expect(r.mayRun(stage), stage).toBe(true);
  });

  it('treats a missing cursor exactly like an empty one — a cache miss must not skip work', () => {
    for (const prior of [null, undefined, { starved: [], yields: 0 }]) {
      expect(decideRotation(prior).yieldTo.size).toBe(0);
    }
  });

  it('runs ONLY the starved stages on the next pass', () => {
    const r = decideRotation({ starved: ['triage'], yields: 0 });
    expect(r.mayRun('triage')).toBe(true);
    expect(r.mayRun('pr_merge')).toBe(false);
    expect(r.mayRun('pr_conduct')).toBe(false);
    expect(r.mayRun('value')).toBe(false);
  });

  it('yields to every starved stage, not just the first', () => {
    const r = decideRotation({ starved: ['pr_merge', 'audit', 'triage'], yields: 0 });
    for (const stage of ['pr_merge', 'audit', 'triage']) expect(r.mayRun(stage), stage).toBe(true);
    for (const stage of ['value', 'assign', 'systemic', 'dispatch']) expect(r.mayRun(stage), stage).toBe(false);
  });

  /**
   * A stage outside the allow-list is infrastructure the pass depends on (the board's
   * lane staffing, the census measurement, the reaper). A scheduling heuristic must never
   * be able to skip one, so non-rotatable stages ignore the rotation entirely.
   */
  it('never withholds a non-rotatable stage', () => {
    const r = decideRotation({ starved: ['triage'], yields: 0 });
    expect(r.mayRun('lane_staffing')).toBe(true);
    expect(r.mayRun('census')).toBe(true);
  });

  it('ignores an unrecognised stage in a stale cursor rather than yielding to nothing', () => {
    // A cursor written by an older deploy could name a stage that no longer exists.
    // Yielding to it would skip every real stage and the pass would do nothing at all.
    const r = decideRotation({ starved: ['a_stage_that_no_longer_exists'], yields: 0 });
    expect(r.yieldTo.size).toBe(0);
    expect(r.mayRun('value')).toBe(true);
  });

  it('gives up after MAX_CONSECUTIVE_YIELDS so the skipped stages are not starved instead', () => {
    const r = decideRotation({ starved: ['triage'], yields: MAX_CONSECUTIVE_YIELDS });
    expect(r.yieldTo.size).toBe(0);
    expect(r.mayRun('pr_merge')).toBe(true);
    expect(r.yields).toBe(0);
  });

  it('counts this pass toward the yield ceiling', () => {
    expect(decideRotation({ starved: ['triage'], yields: 0 }).yields).toBe(1);
    expect(decideRotation({ starved: ['triage'], yields: 1 }).yields).toBe(2);
  });
});

describe('carryOverRotation', () => {
  it('clears the cursor when the pass shed nothing', () => {
    expect(carryOverRotation(decideRotation(null), [])).toEqual({ starved: [], yields: 0 });
  });

  it('carries forward the stages the pass ran out of wall-clock for', () => {
    const rotation = decideRotation(null);
    expect(carryOverRotation(rotation, ['pr_merge', 'audit', 'triage']))
      .toEqual({ starved: ['pr_merge', 'audit', 'triage'], yields: 0 });
  });

  /**
   * THE CYCLE THIS PREVENTS, and the reason `skip` is separate from `shed`.
   *
   * A yielded stage is recorded in `budget.truncated` for honesty — a silent skip is the
   * failure the whole budget exists to end. But it did not run out of time; it was told to
   * wait. Feeding it back would make the two sets chase each other forever: yield to A,
   * skip B, read B as starved, yield to B, skip A, and neither ever completes a pass.
   */
  it('does NOT treat a stage this pass deliberately yielded as starved', () => {
    const rotation = decideRotation({ starved: ['triage'], yields: 0 });
    rotation.skip('pr_merge');
    rotation.skip('value');
    // The pass reports all three; only the genuinely-starved one may be carried over.
    expect(carryOverRotation(rotation, ['pr_merge', 'value', 'triage']))
      .toEqual({ starved: ['triage'], yields: 1 });
  });

  it('reaches an empty cursor once the yielded-to stage finally completes', () => {
    const rotation = decideRotation({ starved: ['triage'], yields: 0 });
    rotation.skip('pr_merge');
    expect(carryOverRotation(rotation, ['pr_merge'])).toEqual({ starved: [], yields: 0 });
  });

  it('drops a non-rotatable stage from the cursor — it will never be yielded to', () => {
    expect(carryOverRotation(decideRotation(null), ['lane_staffing', 'triage']))
      .toEqual({ starved: ['triage'], yields: 0 });
  });

  /**
   * The termination property, stated as a sequence rather than an assertion about one
   * call: a stage that is starved every time it runs cannot yield forever, because the
   * ceiling restores the normal order. Without this the fix would trade triage starvation
   * for the starvation of everything else.
   */
  it('cannot yield indefinitely to a stage that keeps overrunning', () => {
    let cursor = carryOverRotation(decideRotation(null), ['triage']);
    let yieldedPasses = 0;
    for (let pass = 0; pass < 10; pass += 1) {
      const rotation = decideRotation(cursor);
      if (rotation.yieldTo.size > 0) yieldedPasses += 1;
      // The yielded-to stage overruns again every single time.
      for (const stage of ROTATABLE_STAGES) if (!rotation.mayRun(stage)) rotation.skip(stage);
      cursor = carryOverRotation(rotation, ['triage', ...rotation.yielded]);
    }
    expect(yieldedPasses).toBeLessThanOrEqual(10);
    expect(yieldedPasses).toBeGreaterThan(0);
    // And it must have handed turns back: a run of 10 passes cannot all have been yields.
    expect(yieldedPasses).toBeLessThan(10);
  });
});
