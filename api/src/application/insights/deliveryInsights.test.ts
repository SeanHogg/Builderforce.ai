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
});
