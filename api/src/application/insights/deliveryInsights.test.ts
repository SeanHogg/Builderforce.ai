import { describe, expect, it } from 'vitest';
import { summarizeDelivery, type DeliveryTaskRow } from './deliveryInsights';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 5, 27, 12, 0, 0);
const at = (daysAgo: number) => new Date(NOW - daysAgo * DAY);

function task(createdDaysAgo: number, completedDaysAgo: number | null): DeliveryTaskRow {
  return { createdAt: at(createdDaysAgo), completedAt: completedDaysAgo == null ? null : at(completedDaysAgo) };
}

const opts = (over: Partial<Parameters<typeof summarizeDelivery>[1]> = {}) => ({
  scope: 'initiative' as const, scopeId: 'i1', name: 'Init', now: NOW,
  baselineDate: at(30), targetDate: null, ...over,
});

describe('summarizeDelivery', () => {
  it('counts totals and completion %', () => {
    const rows = [task(20, 5), task(18, 2), task(15, null), task(10, null)];
    const r = summarizeDelivery(rows, opts());
    expect(r.totalTasks).toBe(4);
    expect(r.completedTasks).toBe(2);
    expect(r.openTasks).toBe(2);
    expect(r.completionPct).toBeCloseTo(50);
  });

  it('builds a monotonic burnup series ending at the totals', () => {
    const rows = [task(20, 5), task(18, 2), task(15, null)];
    const r = summarizeDelivery(rows, opts());
    expect(r.series.length).toBeGreaterThan(0);
    const last = r.series[r.series.length - 1]!;
    expect(last.scope).toBe(3);
    expect(last.completed).toBe(2);
    expect(last.remaining).toBe(1);
    // scope never decreases across the series
    for (let i = 1; i < r.series.length; i++) expect(r.series[i]!.scope).toBeGreaterThanOrEqual(r.series[i - 1]!.scope);
  });

  it('forecasts a completion date from throughput when work remains', () => {
    // 4 completed in last 28d, 4 still open → ~1 wk/4 done → ~4 weeks out.
    const rows = [task(20, 20), task(18, 14), task(12, 7), task(6, 1), task(5, null), task(4, null), task(3, null), task(2, null)];
    const r = summarizeDelivery(rows, opts());
    expect(r.throughputPerWeek).toBeGreaterThan(0);
    expect(r.forecastDate).not.toBeNull();
    expect(new Date(r.forecastDate!).getTime()).toBeGreaterThan(NOW);
    // optimistic is sooner than pessimistic
    expect(new Date(r.forecastDateOptimistic!).getTime()).toBeLessThan(new Date(r.forecastDatePessimistic!).getTime());
  });

  it('reports no_signal when work is open but nothing completed recently', () => {
    const rows = [task(5, null), task(4, null)];
    const r = summarizeDelivery(rows, opts());
    expect(r.throughputPerWeek).toBe(0);
    expect(r.forecastDate).toBeNull();
    expect(r.status).toBe('no_signal');
  });

  it('marks done when all tasks complete', () => {
    const rows = [task(10, 3), task(8, 1)];
    const r = summarizeDelivery(rows, opts());
    expect(r.status).toBe('done');
  });

  it('verdicts on_track / late against a target date', () => {
    const rows = [task(20, 20), task(18, 14), task(12, 7), task(6, 1), task(5, null)];
    const onTrack = summarizeDelivery(rows, opts({ targetDate: new Date(NOW + 365 * DAY) }));
    expect(onTrack.status).toBe('on_track');
    const late = summarizeDelivery(rows, opts({ targetDate: new Date(NOW - 10 * DAY) }));
    expect(late.status).toBe('late');
  });

  it('measures scope creep relative to the baseline', () => {
    // baseline at 30d ago: 2 created on/before, 2 created after → 100% creep.
    const rows = [task(35, null), task(31, null), task(20, null), task(10, null)];
    const r = summarizeDelivery(rows, opts({ baselineDate: at(30) }));
    expect(r.baselineScope).toBe(2);
    expect(r.addedScope).toBe(2);
    expect(r.addedScopePct).toBeCloseTo(100);
  });

  it('projects the completed line forward to the forecast date', () => {
    const rows = [task(20, 20), task(18, 14), task(12, 7), task(6, 1), task(5, null), task(4, null), task(3, null), task(2, null)];
    const r = summarizeDelivery(rows, opts());
    expect(r.projection.length).toBeGreaterThanOrEqual(2);
    const first = r.projection[0]!, last = r.projection[r.projection.length - 1]!;
    expect(first.completed).toBe(r.completedTasks);   // starts at today's actual
    expect(last.completed).toBe(r.totalTasks);        // ends fully delivered
    expect(last.remaining).toBe(0);
    expect(last.date).toBe(r.forecastDate);           // lands exactly on the forecast
    // completed is non-decreasing across the projection
    for (let i = 1; i < r.projection.length; i++) expect(r.projection[i]!.completed).toBeGreaterThanOrEqual(r.projection[i - 1]!.completed);
  });

  it('emits no projection without a throughput signal', () => {
    const r = summarizeDelivery([task(5, null), task(4, null)], opts());
    expect(r.projection).toEqual([]);
  });

  it('rolls up story points (defined / done / cancelled) excluding cancelled work', () => {
    const tk = (createdDaysAgo: number, completedDaysAgo: number | null, pts: number | null, status?: string): DeliveryTaskRow =>
      ({ createdAt: at(createdDaysAgo), completedAt: completedDaysAgo == null ? null : at(completedDaysAgo), storyPoints: pts, status });
    const rows = [tk(20, 5, 3), tk(18, 2, 5), tk(15, null, 8), tk(10, 1, 2, 'cancelled')];
    const r = summarizeDelivery(rows, opts());
    expect(r.hasPoints).toBe(true);
    expect(r.totalPoints).toBe(16);      // 3 + 5 + 8 (cancelled 2 excluded)
    expect(r.donePoints).toBe(8);        // 3 + 5 completed
    expect(r.cancelledPoints).toBe(2);
    const last = r.scopeEffort[r.scopeEffort.length - 1]!;
    expect(last.definedPoints).toBe(16);
    expect(last.completedPoints).toBe(8);
  });

  it('falls back to no-points when nothing is estimated', () => {
    const r = summarizeDelivery([task(20, 5), task(18, null)], opts());
    expect(r.hasPoints).toBe(false);
    expect(r.totalPoints).toBe(0);
  });

  it('derives a development FTE line from logged effort', () => {
    // One bucket-day with 8h logged ≈ 1 FTE-day; over a weekly bucket FTE is diluted.
    const rows = [task(20, 5), task(18, 2), task(15, null)];
    const effortEntries = [
      { date: at(3).toISOString().slice(0, 10), minutes: 480 },
      { date: at(2).toISOString().slice(0, 10), minutes: 240 },
    ];
    const r = summarizeDelivery(rows, opts({ effortEntries }));
    expect(r.hasEffort).toBe(true);
    expect(r.scopeEffort.some((p) => p.fte > 0)).toBe(true);
    const noEffort = summarizeDelivery(rows, opts());
    expect(noEffort.hasEffort).toBe(false);
    expect(noEffort.scopeEffort.every((p) => p.fte === 0)).toBe(true);
  });

  it('counts distinct active contributors among recently-completed work', () => {
    const owned = (createdDaysAgo: number, completedDaysAgo: number | null, who: string | null): DeliveryTaskRow =>
      ({ createdAt: at(createdDaysAgo), completedAt: completedDaysAgo == null ? null : at(completedDaysAgo), assignedUserId: who });
    const rows = [owned(20, 5, 'u1'), owned(18, 3, 'u2'), owned(15, 2, 'u1'), owned(10, 1, null), owned(8, null, 'u3')];
    const r = summarizeDelivery(rows, opts());
    expect(r.activeContributors).toBe(2); // u1 + u2 completed in-window; u3 not completed, null ignored
  });
});
