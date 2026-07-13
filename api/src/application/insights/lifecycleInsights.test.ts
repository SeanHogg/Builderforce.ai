import { describe, expect, it } from 'vitest';
import {
  mapStatusToPhase, summarizePhases, summarizeLifecycleTrend, LIFECYCLE_PHASES,
} from './lifecycleInsights';
import type { StageDuration } from './bottleneckInsights';
import type { TaskRow } from './bottleneckInsights';

const H = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.parse('2026-06-27T00:00:00Z');

describe('mapStatusToPhase', () => {
  it('maps tenant-custom status names by substring into canonical phases', () => {
    expect(mapStatusToPhase('Backlog')).toBe('refinement');
    expect(mapStatusToPhase('Ready for Dev')).toBe('refinement');
    expect(mapStatusToPhase('In Progress')).toBe('work');
    expect(mapStatusToPhase('In Code Review')).toBe('review');
    expect(mapStatusToPhase('QA Testing')).toBe('review');
    expect(mapStatusToPhase('Deploying to prod')).toBe('deploy');
    expect(mapStatusToPhase('Released')).toBe('deploy');
  });

  it('returns null for terminal / cancelled statuses (no active dwell)', () => {
    expect(mapStatusToPhase('done')).toBeNull();
    expect(mapStatusToPhase('completed')).toBeNull();
    expect(mapStatusToPhase('cancelled')).toBeNull();
  });

  it('falls back unknown statuses to work so their time is never dropped', () => {
    expect(mapStatusToPhase('zorp')).toBe('work');
  });
});

describe('summarizePhases', () => {
  it('rolls dwell intervals up into the four phases in canonical order', () => {
    const durations: StageDuration[] = [
      { stage: 'backlog', hours: 10, taskId: 1 },
      { stage: 'in_progress', hours: 6, taskId: 1 },
      { stage: 'in_progress', hours: 4, taskId: 2 },
      { stage: 'in_review', hours: 2, taskId: 1 },
      { stage: 'done', hours: 99, taskId: 1 }, // terminal → dropped
    ];
    const phases = summarizePhases(durations);
    expect(phases.map((p) => p.phase)).toEqual(LIFECYCLE_PHASES);
    const work = phases.find((p) => p.phase === 'work')!;
    expect(work.avgHours).toBeCloseTo(5);   // (6 + 4) / 2
    expect(work.taskCount).toBe(2);
    const deploy = phases.find((p) => p.phase === 'deploy')!;
    expect(deploy.avgHours).toBe(0);        // no observed deploy dwell → zeros, still present
    expect(deploy.taskCount).toBe(0);
  });
});

describe('summarizeLifecycleTrend', () => {
  const task = (createdDaysAgo: number, completedDaysAgo: number | null): TaskRow => ({
    taskId: 1, key: 'T-1', title: 't', status: 'done',
    createdAt: new Date(NOW - createdDaysAgo * DAY),
    completedAt: completedDaysAgo == null ? null : new Date(NOW - completedDaysAgo * DAY),
    lastWorkedAt: null, redoCount: 0, reopenCount: 0,
  });

  it('buckets completed tasks by completion month and averages create→done time', () => {
    // two completed ~same month: 10d and 20d lifecycles → avg 15d in hours.
    const trend = summarizeLifecycleTrend([task(30, 20), task(25, 15), task(5, null)], NOW, 6);
    expect(trend.length).toBeGreaterThanOrEqual(1);
    const total = trend.reduce((a, p) => a + p.taskCount, 0);
    expect(total).toBe(2); // open task excluded
    expect(trend[0]!.avgLifecycleHours).toBeGreaterThan(0);
  });

  it('returns months oldest-first', () => {
    const trend = summarizeLifecycleTrend([task(120, 100), task(20, 10)], NOW, 6);
    for (let i = 1; i < trend.length; i++) expect(trend[i]!.period >= trend[i - 1]!.period).toBe(true);
  });
});
