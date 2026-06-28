import { describe, expect, it } from 'vitest';
import {
  buildStageDurations,
  summarizeStages,
  pickSlowestStage,
  summarizeRework,
  summarizeAgingWip,
  TERMINAL_STATUSES,
  type TransitionRow,
  type TaskRow,
} from './bottleneckInsights';

/**
 * Locks the pure bottleneck math (no DB): consecutive-transition dwell with
 * open-task extension to now, the sparse-log createdAt→completedAt fallback,
 * slowest-stage selection, rework loop counting, and aging-WIP thresholding +
 * top-N ordering.
 */

const H = 3_600_000;
const NOW = Date.parse('2026-06-27T00:00:00Z');
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H);

function tr(over: Partial<TransitionRow> & Pick<TransitionRow, 'taskId' | 'toStatus' | 'occurredAt'>): TransitionRow {
  return { fromStatus: over.fromStatus ?? null, ...over };
}
function task(over: Partial<TaskRow> & Pick<TaskRow, 'taskId'>): TaskRow {
  return {
    key: over.key ?? `T-${over.taskId}`,
    title: over.title ?? `Task ${over.taskId}`,
    status: over.status ?? 'in_progress',
    createdAt: over.createdAt ?? at(100),
    completedAt: over.completedAt ?? null,
    lastWorkedAt: over.lastWorkedAt ?? null,
    redoCount: over.redoCount ?? 0,
    reopenCount: over.reopenCount ?? 0,
    taskId: over.taskId,
  };
}

describe('buildStageDurations', () => {
  it('diffs consecutive transitions: earlier toStatus held the task for the gap', () => {
    // backlog→in_progress at -10h, in_progress→in_review at -6h, in_review→done at -1h
    const transitions: TransitionRow[] = [
      tr({ taskId: 1, fromStatus: 'backlog', toStatus: 'in_progress', occurredAt: at(10) }),
      tr({ taskId: 1, fromStatus: 'in_progress', toStatus: 'in_review', occurredAt: at(6) }),
      tr({ taskId: 1, fromStatus: 'in_review', toStatus: 'done', occurredAt: at(1) }),
    ];
    const rows = [task({ taskId: 1, status: 'done', completedAt: at(1) })];
    const ds = buildStageDurations(transitions, rows, NOW);
    const byStage = Object.fromEntries(ds.map((d) => [d.stage, d.hours]));
    expect(byStage['in_progress']).toBeCloseTo(4, 5); // -10 → -6
    expect(byStage['in_review']).toBeCloseTo(5, 5);    // -6 → -1
    // terminal 'done' is NOT extended to now
    expect(byStage['done']).toBeUndefined();
  });

  it('extends an OPEN task current stage to now', () => {
    const transitions: TransitionRow[] = [
      tr({ taskId: 2, fromStatus: 'backlog', toStatus: 'in_review', occurredAt: at(8) }),
    ];
    const rows = [task({ taskId: 2, status: 'in_review' })];
    const ds = buildStageDurations(transitions, rows, NOW);
    const review = ds.find((d) => d.stage === 'in_review')!;
    expect(review.hours).toBeCloseTo(8, 5); // -8h → now
  });

  it('falls back to createdAt→completedAt under the final status when no transitions', () => {
    const rows = [task({ taskId: 3, status: 'done', createdAt: at(30), completedAt: at(6) })];
    const ds = buildStageDurations([], rows, NOW);
    expect(ds).toHaveLength(1);
    expect(ds[0]!.stage).toBe('done');
    expect(ds[0]!.hours).toBeCloseTo(24, 5);
  });

  it('falls back to createdAt→now for an open task with no transitions', () => {
    const rows = [task({ taskId: 4, status: 'in_progress', createdAt: at(12), completedAt: null })];
    const ds = buildStageDurations([], rows, NOW);
    expect(ds[0]!.hours).toBeCloseTo(12, 5);
  });
});

describe('summarizeStages / pickSlowestStage', () => {
  it('rolls up avg + median + distinct task count, slowest first', () => {
    const stats = summarizeStages([
      { stage: 'in_review', hours: 10, taskId: 1 },
      { stage: 'in_review', hours: 20, taskId: 2 },
      { stage: 'in_review', hours: 30, taskId: 1 }, // same task again
      { stage: 'in_progress', hours: 2, taskId: 1 },
    ]);
    const review = stats.find((s) => s.stage === 'in_review')!;
    expect(review.avgHours).toBeCloseTo(20, 5);
    expect(review.medianHours).toBeCloseTo(20, 5);
    expect(review.taskCount).toBe(2); // distinct tasks
    expect(stats[0]!.stage).toBe('in_review'); // slowest first
    expect(pickSlowestStage(stats)).toEqual({ stage: 'in_review', avgHours: 20 });
  });

  it('returns null slowest for no data', () => {
    expect(pickSlowestStage(summarizeStages([]))).toBeNull();
  });
});

describe('summarizeRework', () => {
  it('counts reworked tasks and computes the rate', () => {
    const r = summarizeRework([
      task({ taskId: 1, reopenCount: 1 }),
      task({ taskId: 2, redoCount: 2 }),
      task({ taskId: 3 }), // clean
      task({ taskId: 4 }), // clean
    ]);
    expect(r.reworkedTasks).toBe(2);
    expect(r.totalReopens).toBe(1);
    expect(r.totalRedos).toBe(2);
    expect(r.reworkRate).toBeCloseTo(0.5, 5);
  });

  it('null-safes an empty sample', () => {
    const r = summarizeRework([]);
    expect(r.reworkRate).toBe(0);
    expect(r.reworkedTasks).toBe(0);
  });
});

describe('summarizeAgingWip', () => {
  it('flags open tasks idle past the threshold and excludes terminal ones', () => {
    const rows = [
      task({ taskId: 1, status: 'in_progress', lastWorkedAt: at(100) }), // stuck 100h
      task({ taskId: 2, status: 'in_review', lastWorkedAt: at(80) }),     // stuck 80h
      task({ taskId: 3, status: 'in_progress', lastWorkedAt: at(10) }),   // fresh
      task({ taskId: 4, status: 'done', lastWorkedAt: at(500) }),         // terminal → excluded
    ];
    const a = summarizeAgingWip(rows, NOW, 72);
    expect(a.thresholdHours).toBe(72);
    expect(a.stuckCount).toBe(2);
    expect(a.oldest[0]!.taskId).toBe(1); // oldest first
    expect(a.oldest[0]!.ageHours).toBeCloseTo(100, 5);
  });

  it('uses createdAt when lastWorkedAt is null', () => {
    const a = summarizeAgingWip([task({ taskId: 9, status: 'blocked', createdAt: at(200), lastWorkedAt: null })], NOW, 72);
    expect(a.stuckCount).toBe(1);
    expect(a.oldest[0]!.ageHours).toBeCloseTo(200, 5);
  });

  it('honours top-N', () => {
    const rows = Array.from({ length: 5 }, (_, i) => task({ taskId: i + 1, status: 'in_progress', lastWorkedAt: at(100 + i) }));
    const a = summarizeAgingWip(rows, NOW, 72, 3);
    expect(a.stuckCount).toBe(5);
    expect(a.oldest).toHaveLength(3);
  });
});

describe('TERMINAL_STATUSES', () => {
  it('includes done and cancelled', () => {
    expect(TERMINAL_STATUSES.has('done')).toBe(true);
    expect(TERMINAL_STATUSES.has('cancelled')).toBe(true);
    expect(TERMINAL_STATUSES.has('in_progress')).toBe(false);
  });
});
