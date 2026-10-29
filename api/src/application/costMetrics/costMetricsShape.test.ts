import { describe, expect, it } from 'vitest';
import {
  buildCostMetricsReport, buildRunBudget, buildRunCostBreakdown, compareLeverArms, readContextCategories, toGroupMetrics,
  toServedWithoutModel,
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

const NO_SERVED = { served: 0, dispatched: 0 };

describe('servedWithoutModel', () => {
  it('is the share of ALL requests (served without a model + served by one) answered without a model', () => {
    expect(toServedWithoutModel({ served: 25, dispatched: 75 })).toEqual({ requests: 25, share: 0.25 });
    expect(toServedWithoutModel(NO_SERVED)).toEqual({ requests: 0, share: 0 });
  });

  it('rides every report, whatever the grouping', () => {
    const report = buildCostMetricsReport([row()], { window: '7d', windowDays: 7, groupBy: 'actionType', limit: 200, served: { served: 1, dispatched: 3 } });
    expect(report.servedWithoutModel).toEqual({ requests: 1, share: 0.25 });
  });
});

describe('groupBy=day', () => {
  it('is a UTC YYYY-MM-DD series read in ascending key order', () => {
    expect(COST_METRIC_GROUPS.day.key).toContain("'YYYY-MM-DD'");
    expect(COST_METRIC_GROUPS.day.series).toBe(true);
    expect(isCostMetricGroupBy('day')).toBe(true);
    const report = buildCostMetricsReport(
      [row({ groupKey: '2026-10-20' }), row({ groupKey: '2026-10-21' })],
      { window: '7d', windowDays: 7, groupBy: 'day', limit: 200, served: NO_SERVED },
    );
    expect(report.groups.map((g) => g.group)).toEqual(['2026-10-20', '2026-10-21']);
    expect(report.groups[0]).toMatchObject({ calls: 10, costUsd: 5 });
  });
});

describe('buildRunBudget', () => {
  const payload = (limits: Record<string, unknown>) => JSON.stringify({ containmentLimits: limits });

  it('names the payload when the run overrode a cap', () => {
    expect(buildRunBudget({ found: true, declaredSpendMillicents: 500_000, payload: payload({ maxSpendMillicents: 500_000, maxTokens: 1_000 }) }, 'pro'))
      .toEqual({ capUsd: 5, capTokens: 1_000, source: 'payload' });
  });

  it('falls back to the plan token cap and the declared spend row', () => {
    expect(buildRunBudget({ found: true, declaredSpendMillicents: 2_500_000, payload: '{}' }, 'pro'))
      .toEqual({ capUsd: 25, capTokens: 2_000_000, source: 'plan' });
  });

  it('is the platform default when the plan is unknown, and null for a missing run', () => {
    expect(buildRunBudget({ found: true, declaredSpendMillicents: null, payload: 'not json' }, null))
      .toEqual({ capUsd: null, capTokens: 200_000, source: 'default' });
    expect(buildRunBudget({ found: false, declaredSpendMillicents: null, payload: null }, 'pro')).toBeNull();
  });

  it('rides the run breakdown', () => {
    expect(buildRunCostBreakdown(9, [], null, 1000).budget).toBeNull();
    const budget = { capUsd: 1, capTokens: 2, source: 'plan' as const };
    expect(buildRunCostBreakdown(9, [], null, 1000, budget).budget).toEqual(budget);
  });
});

describe('compareLeverArms', () => {
  it('pairs each lever on-arm with its off-arm and differences the metrics', () => {
    const groups = [
      toGroupMetrics(row({ groupKey: 'c2_observation_masking', arm: 'on', cacheReadTokens: 8_000, medianContextTokens: 600 })),
      toGroupMetrics(row({ groupKey: 'c2_observation_masking', arm: 'off', cacheReadTokens: 5_000, medianContextTokens: 1_000 })),
      toGroupMetrics(row({ groupKey: 'b2_semantic_cache', arm: 'off' })),
    ];
    const [b2, c1] = compareLeverArms(groups);
    expect(c1!.lever).toBe('c2_observation_masking');
    expect(c1!.requirement).toBe('C2');
    expect(c1!.delta.cacheHitRate).toBeCloseTo(0.3);
    expect(c1!.delta.medianContextTokens).toBe(-400);
    expect(b2!.on).toBeNull();
    expect(b2!.delta.cacheHitRate).toBeNull();
  });

  it('only builds comparisons for groupBy=lever', () => {
    expect(buildCostMetricsReport([row()], { window: '7d', windowDays: 7, groupBy: 'none', limit: 200, served: NO_SERVED })).not.toHaveProperty('levers');
    const report = buildCostMetricsReport([row({ groupKey: 'c2_observation_masking', arm: 'on' })], { window: '30d', windowDays: 30, groupBy: 'lever', limit: 1, served: NO_SERVED });
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
