import { describe, expect, it } from 'vitest';
import {
  MIN_ARM_CALLS, MIN_ARM_RUNS, budgetUsage, costWindowFor, dailySeries, deltaTone, isThinSample, overallOf, uncachedTokens,
  type CostGroupMetrics,
} from './costMetricsApi';

const arm = (over: Partial<CostGroupMetrics> = {}): CostGroupMetrics => ({
  group: 'c1', arm: 'on', calls: MIN_ARM_CALLS, costUsd: 1,
  cacheHitRate: 0.5, outputInputRatio: 0.1, reasoningShare: null, medianContextTokens: 1000,
  completedRuns: MIN_ARM_RUNS, medianTurnsPerCompletedRun: 4, mergedRuns: MIN_ARM_RUNS,
  costPerMergedPrUsd: 2, medianCostPerMergedPrUsd: 2, ...over,
});

describe('costMetricsApi helpers', () => {
  it('maps the hub window onto the two served windows', () => {
    expect(costWindowFor(7)).toBe('7d');
    expect(costWindowFor(30)).toBe('30d');
    expect(costWindowFor(90)).toBe('30d');
  });

  it('reads the tenant-wide row, null on an empty window', () => {
    expect(overallOf(null)).toBeNull();
    expect(overallOf({ groups: [] } as never)).toBeNull();
    expect(overallOf({ groups: [arm()] } as never)?.group).toBe('c1');
  });

  it('flags a thin arm per metric — calls for ratios, runs for run-level figures', () => {
    expect(isThinSample(null, 'cacheHitRate')).toBe(true);
    expect(isThinSample(arm(), 'cacheHitRate')).toBe(false);
    expect(isThinSample(arm({ calls: MIN_ARM_CALLS - 1 }), 'cacheHitRate')).toBe(true);
    expect(isThinSample(arm({ completedRuns: 1 }), 'cacheHitRate')).toBe(false);
    expect(isThinSample(arm({ completedRuns: 1 }), 'medianTurnsPerCompletedRun')).toBe(true);
    expect(isThinSample(arm({ mergedRuns: 1 }), 'costPerMergedPrUsd')).toBe(true);
  });

  it('tones a delta by the metric’s polarity', () => {
    expect(deltaTone('cacheHitRate', 0.1)).toBe('better');
    expect(deltaTone('cacheHitRate', -0.1)).toBe('worse');
    expect(deltaTone('costPerMergedPrUsd', -1)).toBe('better');
    expect(deltaTone('outputInputRatio', 0.3)).toBe('flat');
    expect(deltaTone('medianContextTokens', null)).toBe('flat');
  });

  it('never reports negative uncached input', () => {
    expect(uncachedTokens({ prompt: 100, cacheRead: 60, cacheCreation: 10 })).toBe(30);
    expect(uncachedTokens({ prompt: 10, cacheRead: 20, cacheCreation: 0 })).toBe(0);
  });
});

describe('dailySeries', () => {
  it('keeps the days that have a value, in order, and drops "no data" instead of plotting 0', () => {
    const report = { groups: [arm({ group: '2026-10-01', cacheHitRate: 0.4 }), arm({ group: '2026-10-02', cacheHitRate: null }), arm({ group: '2026-10-03', cacheHitRate: 0 })] };
    expect(dailySeries(report as never, 'cacheHitRate')).toEqual({ days: ['2026-10-01', '2026-10-03'], values: [0.4, 0] });
    expect(dailySeries(null, 'cacheHitRate')).toEqual({ days: [], values: [] });
  });
});

describe('budgetUsage', () => {
  const totals = { costUsd: 2, promptTokens: 6000, completionTokens: 2000 };
  it('reads used ÷ cap per capped dimension, null where uncapped', () => {
    expect(budgetUsage(totals, { capUsd: 4, capTokens: null, source: 'plan' })).toEqual({ usd: 0.5, tokens: null });
    expect(budgetUsage(totals, { capUsd: null, capTokens: 4000, source: 'payload' })).toEqual({ usd: null, tokens: 2 });
    expect(budgetUsage(totals, null)).toEqual({ usd: null, tokens: null });
    expect(budgetUsage(totals, { capUsd: 0, capTokens: 0, source: 'default' })).toEqual({ usd: null, tokens: null });
  });
});
