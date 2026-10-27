import { describe, expect, it } from 'vitest';
import { MIN_QUICK_RUNS_FOR_SUGGESTION, misroutedRuns, suggestThreshold, summarizeRouteRuns, type RouteRunRecord } from './index.js';

const at = (minutes: number): string => new Date(Date.UTC(2026, 9, 1, 12, minutes)).toISOString();

const quick = (conversation: string, minutes: number, score = 0.3, extra: Partial<RouteRunRecord> = {}): RouteRunRecord =>
  ({ route: 'quick', score, costMc: 100, conversation, startedAt: at(minutes), ...extra });
const full = (conversation: string, minutes: number, score = 0.8): RouteRunRecord =>
  ({ route: 'full', score, costMc: 1_000, conversation, startedAt: at(minutes) });

describe('misroutedRuns', () => {
  it('a quick run re-run full in the same conversation within the window is misrouted', () => {
    const runs = [quick('a', 0), full('a', 10), quick('b', 0), full('b', 45), quick('c', 0), full('d', 5)];
    expect([...misroutedRuns(runs)]).toEqual([0]);
  });

  it('a quick run the host recorded as failed is misrouted', () => {
    expect([...misroutedRuns([quick('a', 0, 0.3, { failed: true })])]).toEqual([0]);
  });

  it('only the NEXT run counts', () => {
    expect(misroutedRuns([quick('a', 0), quick('a', 5), full('a', 10)]).has(0)).toBe(false);
  });
});

describe('summarizeRouteRuns', () => {
  it('totals runs, cost and mean score per route, and bins the scores', () => {
    const r = summarizeRouteRuns([quick('a', 0, 0.2), quick('b', 0, 0.4), full('c', 0, 0.9)], { threshold: 0.5 });
    expect(r.runs).toBe(3);
    expect(r.byRoute.quick).toEqual({ runs: 2, costMc: 200, avgScore: 0.3 });
    expect(r.byRoute.full).toEqual({ runs: 1, costMc: 1_000, avgScore: 0.9 });
    expect(r.histogram).toHaveLength(10);
    expect(r.histogram[2]).toMatchObject({ quick: 1, full: 0 });
    expect(r.histogram[9]).toMatchObject({ full: 1 });
    expect(r.misrouteRate).toBe(0);
  });

  it('runs without a score are counted but not binned', () => {
    const r = summarizeRouteRuns([{ ...quick('a', 0), score: null }]);
    expect(r.byRoute.quick.avgScore).toBeNull();
    expect(r.histogram.reduce((n, b) => n + b.quick + b.full, 0)).toBe(0);
  });
});

describe('suggestThreshold', () => {
  const many = (n: number, misrouted: number, score: number): RouteRunRecord[] => {
    const out: RouteRunRecord[] = [];
    for (let i = 0; i < n; i++) {
      out.push(quick(`q${i}`, 0, score));
      if (i < misrouted) out.push(full(`q${i}`, 5));
    }
    return out;
  };

  it('keeps the threshold on too little evidence', () => {
    expect(suggestThreshold(many(MIN_QUICK_RUNS_FOR_SUGGESTION - 1, 5, 0.3), 0.5).suggestedThreshold).toBeNull();
  });

  it('lowers it when too many quick runs are misrouted', () => {
    const s = suggestThreshold(many(10, 4, 0.32), 0.5);
    expect(s.suggestedThreshold).toBe(0.3);
    expect(s.suggestion).toContain('Lower');
  });

  it('raises it when almost none are', () => {
    const runs = [...many(20, 0, 0.3), full('x', 0)];
    expect(suggestThreshold(runs, 0.5).suggestedThreshold).toBe(0.55);
  });

  it('keeps it inside the band', () => {
    expect(suggestThreshold(many(10, 1, 0.3), 0.5).suggestedThreshold).toBeNull();
  });
});
