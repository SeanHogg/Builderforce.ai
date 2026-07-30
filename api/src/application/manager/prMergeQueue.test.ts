import { describe, it, expect } from 'vitest';
import { planMergeQueue, summarizeMergeQueue, MERGE_QUEUE_DEPTH, type QueuedPr } from './prMergeQueue';
import { MAX_REMEDY_ATTEMPTS } from './stallTriage';

const pr = (id: string, over: Partial<QueuedPr> = {}): QueuedPr =>
  ({ id, taskId: Number(id), syncs: 0, mergeFailures: 0, conflicts: 0, ...over });

const never = () => false;
const dispositions = (plan: ReturnType<typeof planMergeQueue>) => plan.map((e) => e.disposition);

describe('merge queue', () => {
  /**
   * THE MEASUREMENT. Project 11, 2026-07-30: the PR stage was 28839ms of a 30888ms pass
   * — 93% — and bought 233 conflicts, 0 merges, 0 finished tickets. Twenty PRs worked per
   * pass, every one a provider round-trip, against a base only one of them can reach.
   */
  it('spends provider round-trips on the head only, whatever the window size', () => {
    const plan = planMergeQueue(Array.from({ length: 20 }, (_, i) => pr(`${i}`)), { hasActiveRun: never });
    expect(plan.filter((e) => e.disposition === 'work')).toHaveLength(MERGE_QUEUE_DEPTH);
    expect(plan.filter((e) => e.disposition === 'queued')).toHaveLength(20 - MERGE_QUEUE_DEPTH);
    // And the head is the FRONT of the given order — the queue is only a queue if the
    // order it was handed is the order it works.
    expect(dispositions(plan).slice(0, MERGE_QUEUE_DEPTH)).toEqual(Array(MERGE_QUEUE_DEPTH).fill('work'));
  });

  /**
   * Only one resolution can survive: the second is invalidated the instant the head
   * merges, and finding that out costs a billable cloud run (measured at 16.4s, against a
   * 14s discretionary window). So the depth bounds cheap work; recovery is bounded at one.
   */
  it('allows exactly one conflict-recovery dispatch per pass', () => {
    const plan = planMergeQueue(Array.from({ length: 20 }, (_, i) => pr(`${i}`)), { hasActiveRun: never });
    expect(plan.filter((e) => e.mayRecover)).toHaveLength(1);
    expect(plan[0].mayRecover).toBe(true);
    // A queued PR must never carry the permission — that is the whole overrun.
    for (const e of plan.filter((x) => x.disposition !== 'work')) expect(e.mayRecover).toBe(false);
  });

  /**
   * THE ADVANCE MECHANISM. A queue that cannot retire its head is a stall with extra
   * steps, so a spent ceiling must both take the PR out of the queue AND cost nothing —
   * it is three comparisons and one journal write, no provider call.
   */
  it('retires a PR whose ceiling is spent without consuming a head slot', () => {
    const spent = MAX_REMEDY_ATTEMPTS;
    const plan = planMergeQueue([
      pr('1', { syncs: spent }),
      pr('2', { mergeFailures: spent }),
      pr('3', { conflicts: spent }),
      pr('4'), pr('5'), pr('6'), pr('7'),
    ], { hasActiveRun: never });
    expect(dispositions(plan)).toEqual([
      'sync_exhausted', 'merge_exhausted', 'conflict_exhausted',
      'work', 'work', 'work', 'queued',
    ]);
    // Three retirements did not eat the three work slots: the queue drains and advances
    // in the SAME pass, which is what stops a window of dead PRs blocking live ones.
    expect(summarizeMergeQueue(plan)).toMatchObject({ worked: 3, retired: 3, queued: 1 });
  });

  /**
   * A ceiling is a statement that the runs against this PR are NOT working, so it has to
   * outrank the run itself. Checking `running` first would make a livelocked PR — one
   * whose resolution run respawns every pass — permanently unretirable, which is the
   * exact shape of the 26-day `failure_breaker` cohort.
   */
  it('retires an exhausted PR even while a run is still active against it', () => {
    const plan = planMergeQueue([pr('1', { conflicts: MAX_REMEDY_ATTEMPTS })], { hasActiveRun: () => true });
    expect(dispositions(plan)).toEqual(['conflict_exhausted']);
  });

  /**
   * A resolution run in flight IS the expensive work happening, so it costs the manager
   * nothing and must not hold a slot — otherwise one slow run parks the whole queue for
   * as long as it lives.
   */
  it('slides past a PR whose resolution is already running', () => {
    const plan = planMergeQueue(
      [pr('1'), pr('2'), pr('3'), pr('4'), pr('5')],
      { hasActiveRun: (p) => p.id === '1' },
    );
    expect(dispositions(plan)).toEqual(['running', 'work', 'work', 'work', 'queued']);
    // The recovery permission moves with the head, so a running PR does not strand it.
    expect(plan[1].mayRecover).toBe(true);
  });

  it('is total — every PR in the window gets a disposition', () => {
    const window = Array.from({ length: 31 }, (_, i) => pr(`${i}`, i % 4 === 0 ? { syncs: MAX_REMEDY_ATTEMPTS } : {}));
    const plan = planMergeQueue(window, { hasActiveRun: (p) => p.id === '7' });
    expect(plan).toHaveLength(window.length);
    expect(plan.map((e) => e.pr.id)).toEqual(window.map((p) => p.id));
    const s = summarizeMergeQueue(plan);
    expect(s.worked + s.queued + s.retired + s.running).toBe(window.length);
  });

  /**
   * A null counter is a PR the grouped scan found no actions for — never worked, not
   * exhausted. Reading it as exhausted would retire every fresh PR on sight.
   */
  it('treats an unrecorded counter as zero attempts, not as a spent ceiling', () => {
    const plan = planMergeQueue(
      [{ id: '1', taskId: null, syncs: null, mergeFailures: null, conflicts: null }],
      { hasActiveRun: never },
    );
    expect(dispositions(plan)).toEqual(['work']);
  });

  /**
   * The depth has to leave the pass usable: at the measured ~1.4s per worked PR it must
   * fit inside the discretionary window with room for the stages after it.
   */
  it('keeps the head small enough to fit the pass', () => {
    expect(MERGE_QUEUE_DEPTH).toBeGreaterThan(0);
    expect(MERGE_QUEUE_DEPTH * 1_400).toBeLessThan(14_000 / 2);
  });
});
