import { describe, expect, it } from 'vitest';
import {
  buildCostMetricsReport, buildRunCostBreakdown, compareLeverArms, readContextCategories, toGroupMetrics,
} from './costMetricsShape';
import type { CostMetricRow, RunTurnRow } from './costMetricsStore';
import { COST_METRIC_GROUPS, COST_METRIC_GROUP_BYS, isCostMetricGroupBy, isCostMetricWindow } from './costMetricGroups';

const row = (over: Partial<CostMetricRow> = {}): CostMetricRow => ({
  groupKey: 'all', arm: '', calls: 10, promptTokens: 10_000, completionTokens: 2_000, cacheReadTokens: 6_000,
  reasoningTokens: 300, reasoningReportedCompletion: 1_000, costMillicents: 500_000, medianContextTokens: 900,
  completedRuns: 4, medianTurns: 7, mergedRuns: 2, mergedCostMillicents: 300_000, medianMergedCostMillicents: 150_000,
  ...over,
});

describe('toGroupMetrics', () => {
  it('derives every A4 ratio from the raw aggregates', () => {
    const m = toGroupMetrics(row());
    expect(m.cacheHitRate).toBeCloseTo(0.6);
    expect(m.outputInputRatio).toBeCloseTo(0.2);
    // Reasoning share is over the rows that REPORTED a split, not all completion tokens.
    expect(m.reasoningShare).toBeCloseTo(0.3);
    expect(m.costUsd).toBe(5);
    expect(m.medianTurnsPerCompletedRun).toBe(7);
    // Per-run attribution: Σ merged runs' own cost ÷ merged runs — not window spend ÷ merges.
    expect(m.costPerMergedPrUsd).toBe(1.5);
    expect(m.medianCostPerMergedPrUsd).toBe(1.5);
    expect(m).not.toHaveProperty('arm');
  });

  it('reads a zero denominator as no data (null), never 0', () => {
    const m = toGroupMetrics(row({ promptTokens: 0, reasoningReportedCompletion: 0, mergedRuns: 0, medianMergedCostMillicents: null }));
    expect(m.cacheHitRate).toBeNull();
    expect(m.outputInputRatio).toBeNull();
    expect(m.reasoningShare).toBeNull();
    expect(m.costPerMergedPrUsd).toBeNull();
    expect(m.medianCostPerMergedPrUsd).toBeNull();
  });
});

describe('compareLeverArms', () => {
  it('pairs each lever on-arm with its off-arm and differences the metrics', () => {
    const groups = [
      toGroupMetrics(row({ groupKey: 'c1_deferred_tools', arm: 'on', cacheReadTokens: 8_000, medianContextTokens: 600 })),
      toGroupMetrics(row({ groupKey: 'c1_deferred_tools', arm: 'off', cacheReadTokens: 5_000, medianContextTokens: 1_000 })),
      toGroupMetrics(row({ groupKey: 'b2_semantic_cache', arm: 'off' })),
    ];
    const [b2, c1] = compareLeverArms(groups);
    expect(c1!.lever).toBe('c1_deferred_tools');
    expect(c1!.requirement).toBe('C1');
    expect(c1!.delta.cacheHitRate).toBeCloseTo(0.3);
    expect(c1!.delta.medianContextTokens).toBe(-400);
    expect(b2!.on).toBeNull();
    expect(b2!.delta.cacheHitRate).toBeNull();
  });

  it('only builds comparisons for groupBy=lever', () => {
    expect(buildCostMetricsReport([row()], { window: '7d', windowDays: 7, groupBy: 'none', limit: 200 })).not.toHaveProperty('levers');
    const report = buildCostMetricsReport([row({ groupKey: 'c1_deferred_tools', arm: 'on' })], { window: '30d', windowDays: 30, groupBy: 'lever', limit: 1 });
    expect(report.levers).toHaveLength(1);
    expect(report.truncated).toBe(true);
    expect(report.basis).toBe('provider_reported');
  });
});

describe('buildRunCostBreakdown', () => {
  const turn = (over: Partial<RunTurnRow> = {}): RunTurnRow => ({
    id: 1, createdAt: new Date('2026-10-20T00:00:00Z'), model: 'm', role: 'code', turnIndex: 1, calls: 1,
    promptTokens: 1_000, completionTokens: 100, cacheReadTokens: 500, cacheCreationTokens: 0, reasoningTokens: null,
    toolSchemaTokens: 400, costUsdMillicents: 1_000, byo: false,
    context: { system: 100, tools: 400, history: 300, toolOutputs: 200, memory: 0, estimated: true },
    ...over,
  });

  it('totals the turns and keeps the reasoning total null when no turn reported one', () => {
    const b = buildRunCostBreakdown(9, [turn(), turn({ id: 2, turnIndex: 2, reasoningTokens: null })], null, 1000);
    expect(b.totals).toMatchObject({ turns: 2, promptTokens: 2_000, cacheReadTokens: 1_000, reasoningTokens: null, costUsd: 0.02 });
    expect(b.totals.cacheHitRate).toBeCloseTo(0.5);
    expect(b.turns[0]!.categories).toEqual({ system: 100, tools: 400, history: 300, toolOutputs: 200, memory: 0 });
    expect(b.estimatedFields).toEqual(['toolSchemaTokens', 'categories']);
  });

  it('sums reported reasoning and drops a malformed category split', () => {
    const b = buildRunCostBreakdown(9, [turn({ reasoningTokens: 40, context: { system: 'x' } })], null, 1000);
    expect(b.totals.reasoningTokens).toBe(40);
    expect(b.turns[0]!.categories).toBeNull();
    expect(readContextCategories(null)).toBeNull();
  });
});

describe('costMetricGroups', () => {
  it('declares a group spec for every groupBy and validates the query params', () => {
    for (const g of COST_METRIC_GROUP_BYS) expect(COST_METRIC_GROUPS[g].key.length).toBeGreaterThan(0);
    expect(isCostMetricGroupBy('lever')).toBe(true);
    expect(isCostMetricGroupBy('model; DROP TABLE x')).toBe(false);
    expect(isCostMetricWindow('7d')).toBe(true);
    expect(isCostMetricWindow('90d')).toBe(false);
    expect(isCostMetricWindow('toString')).toBe(false);
  });
});
