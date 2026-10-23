import { apiRequest } from './apiClient';

/**
 * "Cost efficiency" (LLM Cost Optimization · A4) — client mirror of
 * api/src/application/costMetrics/costMetricsShape.ts, served by
 *
 *   GET /api/cost/metrics?window=7d|30d&groupBy=none|actionType|role|lever|day
 *   GET /api/cost/runs/:executionId
 *
 * Manager role + premium insights plan feature server-side (`insights.costEfficiency`
 * mirrors the role half). Token figures are provider-reported; cost is the cost the
 * ledger stamped at write time. A ratio with no denominator is `null` ("no data"),
 * never 0 — every helper below keeps that distinction.
 */

export type CostMetricWindow = '7d' | '30d';
/** `day` = one group per UTC day, keyed `YYYY-MM-DD`, ascending — the trend series. */
export type CostMetricGroupBy = 'none' | 'actionType' | 'role' | 'lever' | 'day';
/** The dimensions the lens's grouping switch offers (lever has its own table). */
export const COST_GROUPINGS = ['actionType', 'role'] as const;
export type CostGrouping = (typeof COST_GROUPINGS)[number];

export interface CostGroupMetrics {
  group: string;
  arm?: 'on' | 'off';
  calls: number;
  costUsd: number;
  cacheHitRate: number | null;
  outputInputRatio: number | null;
  reasoningShare: number | null;
  medianContextTokens: number | null;
  completedRuns: number;
  medianTurnsPerCompletedRun: number | null;
  mergedRuns: number;
  costPerMergedPrUsd: number | null;
  medianCostPerMergedPrUsd: number | null;
}

export const COMPARED_METRICS = [
  'cacheHitRate', 'outputInputRatio', 'reasoningShare', 'medianContextTokens',
  'medianTurnsPerCompletedRun', 'costPerMergedPrUsd',
] as const;
export type ComparedMetric = (typeof COMPARED_METRICS)[number];

export interface LeverComparison {
  lever: string;
  requirement: string | null;
  on: CostGroupMetrics | null;
  off: CostGroupMetrics | null;
  delta: Record<ComparedMetric, number | null>;
}

/** Requests answered with no model call at all (cache, deterministic route, local skip). */
export interface ServedWithoutModel {
  requests: number;
  /** 0..1 of all requests in the window. */
  share: number;
}

export interface CostMetricsReport {
  window: CostMetricWindow;
  windowDays: number;
  groupBy: CostMetricGroupBy;
  basis: 'provider_reported';
  truncated: boolean;
  groups: CostGroupMetrics[];
  levers?: LeverComparison[];
  /** Absent from a server that predates the field — the KPI is then left out, not zeroed. */
  servedWithoutModel?: ServedWithoutModel;
}

export interface RunOutcome {
  actionType: string;
  role: string | null;
  merged: boolean;
  terminalStatus: string;
  steps: number;
}

export interface TurnContextCategories {
  system: number;
  tools: number;
  history: number;
  toolOutputs: number;
  memory: number;
}

export interface RunTurnBreakdown {
  turnIndex: number | null;
  at: string;
  model: string;
  role: string | null;
  calls: number;
  tokens: { prompt: number; completion: number; cacheRead: number; cacheCreation: number; reasoning: number | null };
  costUsd: number;
  byo: boolean;
  /** ESTIMATE (chars/4). */
  toolSchemaTokens: number | null;
  /** ESTIMATE (chars/4). */
  categories: TurnContextCategories | null;
}

export interface RunCostBreakdown {
  executionId: number;
  outcome: RunOutcome | null;
  totals: {
    turns: number;
    promptTokens: number;
    completionTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    reasoningTokens: number | null;
    costUsd: number;
    cacheHitRate: number | null;
  };
  turns: RunTurnBreakdown[];
  estimatedFields: ReadonlyArray<'toolSchemaTokens' | 'categories'>;
  truncated: boolean;
  /** The run's spend cap and where it came from; null (or absent) = no cap applies. */
  budget?: RunBudget | null;
}

export interface RunBudget {
  capUsd: number | null;
  capTokens: number | null;
  /** `payload` = set on the run itself · `plan` = the tenant plan's cap · `default` = the platform default. */
  source: 'payload' | 'plan' | 'default';
}

/** How much of a run's cap it used, per capped dimension (0..∞; >1 = over cap). Null where uncapped. */
export function budgetUsage(
  totals: Pick<RunCostBreakdown['totals'], 'costUsd' | 'promptTokens' | 'completionTokens'>,
  budget: RunBudget | null | undefined,
): { usd: number | null; tokens: number | null } {
  const ratio = (used: number, cap: number | null | undefined): number | null =>
    cap != null && cap > 0 ? used / cap : null;
  return {
    usd: ratio(totals.costUsd, budget?.capUsd),
    tokens: ratio(totals.promptTokens + totals.completionTokens, budget?.capTokens),
  };
}

/** The hub's 7/30/90-day selector, onto the two windows the endpoint serves. */
export function costWindowFor(days: number): CostMetricWindow {
  return days <= 7 ? '7d' : '30d';
}

/** The tenant-wide row of a `groupBy=none` report, or null when the window is empty. */
export function overallOf(report: CostMetricsReport | null | undefined): CostGroupMetrics | null {
  return report?.groups[0] ?? null;
}

/**
 * Below these an arm's figure is noise, not evidence. Token ratios need calls; the
 * run-level medians need runs. Kept here (not in the table) so the summary and the
 * table can never disagree about what "insufficient sample" means.
 */
export const MIN_ARM_CALLS = 30;
export const MIN_ARM_RUNS = 5;

const RUN_LEVEL: ReadonlySet<ComparedMetric> = new Set(['medianTurnsPerCompletedRun', 'costPerMergedPrUsd']);

/** Whether one arm's figure for `metric` rests on too small a sample to read. */
export function isThinSample(arm: CostGroupMetrics | null, metric: ComparedMetric): boolean {
  if (!arm) return true;
  if (arm.calls < MIN_ARM_CALLS) return true;
  if (metric === 'costPerMergedPrUsd') return arm.mergedRuns < MIN_ARM_RUNS;
  if (RUN_LEVEL.has(metric)) return arm.completedRuns < MIN_ARM_RUNS;
  return false;
}

/**
 * Which way is "better" for a metric — drives the delta's tone. `neutral` where a
 * move either way is not by itself good or bad (output/input depends on the work).
 */
export const METRIC_POLARITY: Record<ComparedMetric, 'higher' | 'lower' | 'neutral'> = {
  cacheHitRate: 'higher',
  outputInputRatio: 'neutral',
  reasoningShare: 'lower',
  medianContextTokens: 'lower',
  medianTurnsPerCompletedRun: 'lower',
  costPerMergedPrUsd: 'lower',
};

export type DeltaTone = 'better' | 'worse' | 'flat';

/** The tone of an `on − off` delta for a metric. */
export function deltaTone(metric: ComparedMetric, delta: number | null): DeltaTone {
  const polarity = METRIC_POLARITY[metric];
  if (delta == null || delta === 0 || polarity === 'neutral') return 'flat';
  return (delta > 0) === (polarity === 'higher') ? 'better' : 'worse';
}

/**
 * One metric as a daily series from a `groupBy=day` report: the days that have a value
 * for it, in order. A day with no denominator is DROPPED rather than plotted as 0 — "no
 * data" must never read as a real zero on the line.
 */
export function dailySeries(
  report: CostMetricsReport | null | undefined,
  metric: ComparedMetric,
): { days: string[]; values: number[] } {
  const days: string[] = [];
  const values: number[] = [];
  for (const g of report?.groups ?? []) {
    const v = g[metric];
    if (v == null || !Number.isFinite(v)) continue;
    days.push(g.group);
    values.push(v);
  }
  return { days, values };
}

/** Prompt tokens that were neither read from nor written to the cache. */
export function uncachedTokens(t: { prompt: number; cacheRead: number; cacheCreation: number }): number {
  return Math.max(0, t.prompt - t.cacheRead - t.cacheCreation);
}

export const costMetricsApi = {
  metrics: (window: CostMetricWindow, groupBy: CostMetricGroupBy): Promise<CostMetricsReport> =>
    apiRequest<CostMetricsReport>(
      `/api/cost/metrics?window=${encodeURIComponent(window)}&groupBy=${encodeURIComponent(groupBy)}`,
    ),
  run: (executionId: number): Promise<RunCostBreakdown> =>
    apiRequest<RunCostBreakdown>(`/api/cost/runs/${encodeURIComponent(String(executionId))}`),
};
