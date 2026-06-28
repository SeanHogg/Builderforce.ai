import { describe, expect, it } from 'vitest';
import { summarizeVelocity, type SprintMeta, type VelocityTaskRow } from './velocityInsights';

const meta = (id: string, status: string, endDate: string | null): SprintMeta => ({ id, name: `Sprint ${id}`, status, endDate: endDate ? new Date(endDate) : null });
const tk = (storyPoints: number | null, done: boolean): VelocityTaskRow => ({ sprintId: 's', storyPoints, completedAt: done ? new Date() : null });

describe('summarizeVelocity', () => {
  it('sums committed vs completed points per sprint', () => {
    const metas = [meta('s1', 'active', '2026-06-20')];
    const map = new Map([['s1', [tk(5, true), tk(3, true), tk(8, false)]]]);
    const r = summarizeVelocity(metas, map.set('s1', map.get('s1')!.map((t) => ({ ...t, sprintId: 's1' }))));
    const s = r.sprints[0]!;
    expect(s.committedPoints).toBe(16);
    expect(s.completedPoints).toBe(8);
    expect(s.completedCount).toBe(2);
    expect(s.completionRatePct).toBeCloseTo(50);
  });

  it('averages completed points over recent COMPLETED sprints for the forecast', () => {
    const metas = [
      meta('s1', 'completed', '2026-05-01'),
      meta('s2', 'completed', '2026-05-15'),
      meta('s3', 'active', '2026-06-01'),
    ];
    const map = new Map<string, VelocityTaskRow[]>([
      ['s1', [{ sprintId: 's1', storyPoints: 10, completedAt: new Date() }]],
      ['s2', [{ sprintId: 's2', storyPoints: 20, completedAt: new Date() }]],
      ['s3', [{ sprintId: 's3', storyPoints: 99, completedAt: null }]], // active → excluded from avg
    ]);
    const r = summarizeVelocity(metas, map);
    expect(r.velocitySampleSize).toBe(2);
    expect(r.averageVelocity).toBeCloseTo(15); // (10 + 20) / 2
  });

  it('counts estimated vs unestimated tasks (data hygiene)', () => {
    const metas = [meta('s1', 'active', null)];
    const map = new Map<string, VelocityTaskRow[]>([['s1', [
      { sprintId: 's1', storyPoints: 5, completedAt: null },
      { sprintId: 's1', storyPoints: null, completedAt: null },
    ]]]);
    const r = summarizeVelocity(metas, map);
    expect(r.estimatedTasks).toBe(1);
    expect(r.unestimatedTasks).toBe(1);
  });

  it('handles a sprint with no tasks / no points without dividing by zero', () => {
    const r = summarizeVelocity([meta('s1', 'completed', '2026-06-01')], new Map());
    expect(r.sprints[0]!.committedPoints).toBe(0);
    expect(r.sprints[0]!.completionRatePct).toBeNull();
    expect(r.averageVelocity).toBe(0); // completed sprint, zero points
  });
});
