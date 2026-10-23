/**
 * How the A4 cost-metric aggregates are READ — pure, so every ratio and the on/off
 * lever comparison is unit-testable without a database.
 *
 *   cacheHitRate              cache_read / prompt tokens (cache reads are a subset of prompt)
 *   outputInputRatio          completion / prompt tokens
 *   reasoningShare            reasoning / completion tokens, over the rows that REPORTED
 *                             a split only (Anthropic reports none — NULL, not 0)
 *   medianContextTokens       median provider-reported prompt tokens per turn
 *   medianTurnsPerCompletedRun median LLM turns of a run whose outcome is `completed`
 *   costPerMergedPrUsd        Σ cost of the MERGED runs ÷ merged runs — each merged run's
 *                             own attributed spend (execution_id ⋈ run_model_outcomes),
 *                             never "window spend ÷ merges"
 *
 * A ratio with a zero denominator is `null` ("no data"), never 0.
 */
import { costLeverSpec, type CostLeverId } from '@builderforce/cost-levers';
import { millicentsToUsd } from '../../domain/shared/money';
import type { CostMetricGroupBy, CostMetricWindow } from './costMetricGroups';
import type { CostMetricRow, RunOutcomeRow, RunTurnRow } from './costMetricsStore';

export interface CostGroupMetrics {
  group: string;
  /** Lever grouping only: the arm this group's rows ran under. */
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

/** The numeric metrics a lever comparison differences. */
export const COMPARED_METRICS = [
  'cacheHitRate', 'outputInputRatio', 'reasoningShare', 'medianContextTokens',
  'medianTurnsPerCompletedRun', 'costPerMergedPrUsd',
] as const satisfies ReadonlyArray<keyof CostGroupMetrics>;
export type ComparedMetric = (typeof COMPARED_METRICS)[number];

export interface LeverComparison {
  lever: string;
  /** PRD requirement id ("C1"), when the lever is in the manifest. */
  requirement: string | null;
  on: CostGroupMetrics | null;
  off: CostGroupMetrics | null;
  /** on − off per metric; null when either arm has no figure. */
  delta: Record<ComparedMetric, number | null>;
}

export interface CostMetricsReport {
  window: CostMetricWindow;
  windowDays: number;
  groupBy: CostMetricGroupBy;
  /** Token figures are provider-reported; cost is the write-time stamped cost. */
  basis: 'provider_reported';
  /** The group list hit its cap — the tail is not shown. */
  truncated: boolean;
  groups: CostGroupMetrics[];
  /** groupBy=lever only. */
  levers?: LeverComparison[];
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

export function toGroupMetrics(r: CostMetricRow): CostGroupMetrics {
  return {
    group: r.groupKey,
    ...(r.arm === 'on' || r.arm === 'off' ? { arm: r.arm } : {}),
    calls: r.calls,
    costUsd: millicentsToUsd(r.costMillicents),
    cacheHitRate: ratio(r.cacheReadTokens, r.promptTokens),
    outputInputRatio: ratio(r.completionTokens, r.promptTokens),
    reasoningShare: ratio(r.reasoningTokens, r.reasoningReportedCompletion),
    medianContextTokens: r.medianContextTokens,
    completedRuns: r.completedRuns,
    medianTurnsPerCompletedRun: r.medianTurns,
    mergedRuns: r.mergedRuns,
    costPerMergedPrUsd: r.mergedRuns > 0 ? millicentsToUsd(r.mergedCostMillicents) / r.mergedRuns : null,
    medianCostPerMergedPrUsd: r.medianMergedCostMillicents != null ? millicentsToUsd(r.medianMergedCostMillicents) : null,
  };
}

function requirementOf(lever: string): string | null {
  try { return costLeverSpec(lever as CostLeverId).requirement; } catch { return null; }
}

/** Pair each lever's on-arm with its off-arm. */
export function compareLeverArms(groups: readonly CostGroupMetrics[]): LeverComparison[] {
  const byLever = new Map<string, { on: CostGroupMetrics | null; off: CostGroupMetrics | null }>();
  for (const g of groups) {
    if (!g.arm) continue;
    const entry = byLever.get(g.group) ?? { on: null, off: null };
    entry[g.arm] = g;
    byLever.set(g.group, entry);
  }
  return [...byLever.entries()]
    .map(([lever, { on, off }]) => {
      const delta = {} as Record<ComparedMetric, number | null>;
      for (const m of COMPARED_METRICS) {
        const a = on?.[m];
        const b = off?.[m];
        delta[m] = a != null && b != null ? a - b : null;
      }
      return { lever, requirement: requirementOf(lever), on, off, delta };
    })
    .sort((a, b) => a.lever.localeCompare(b.lever));
}

export function buildCostMetricsReport(
  rows: readonly CostMetricRow[],
  args: { window: CostMetricWindow; windowDays: number; groupBy: CostMetricGroupBy; limit: number },
): CostMetricsReport {
  const groups = rows.map(toGroupMetrics);
  return {
    window: args.window,
    windowDays: args.windowDays,
    groupBy: args.groupBy,
    basis: 'provider_reported',
    truncated: rows.length >= args.limit,
    groups,
    ...(args.groupBy === 'lever' ? { levers: compareLeverArms(groups) } : {}),
  };
}

// ── Per-run breakdown ────────────────────────────────────────────────────────

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
  /** >1 only on a row the day fold merged (older than the fold boundary). */
  calls: number;
  tokens: { prompt: number; completion: number; cacheRead: number; cacheCreation: number; reasoning: number | null };
  costUsd: number;
  byo: boolean;
  /** ESTIMATE (chars/4). */
  toolSchemaTokens: number | null;
  /** ESTIMATE (chars/4); null when the producer did not measure it. */
  categories: TurnContextCategories | null;
}

export interface RunCostBreakdown {
  executionId: number;
  outcome: RunOutcomeRow | null;
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
  /** Fields that are character estimates, not provider-reported. */
  estimatedFields: ReadonlyArray<'toolSchemaTokens' | 'categories'>;
  truncated: boolean;
}

const CATEGORY_KEYS = ['system', 'tools', 'history', 'toolOutputs', 'memory'] as const;

/** The persisted `metadata.context` split, or null when absent / malformed. */
export function readContextCategories(raw: unknown): TurnContextCategories | null {
  if (!raw || typeof raw !== 'object') return null;
  const src = raw as Record<string, unknown>;
  const out = {} as TurnContextCategories;
  for (const k of CATEGORY_KEYS) {
    const v = Number(src[k]);
    if (!Number.isFinite(v) || v < 0) return null;
    out[k] = v;
  }
  return out;
}

export function buildRunCostBreakdown(
  executionId: number,
  turns: readonly RunTurnRow[],
  outcome: RunOutcomeRow | null,
  limit: number,
): RunCostBreakdown {
  let calls = 0, prompt = 0, completion = 0, cacheRead = 0, cacheCreation = 0, cost = 0;
  let reasoning: number | null = null;
  const out = turns.map((t): RunTurnBreakdown => {
    calls += t.calls; prompt += t.promptTokens; completion += t.completionTokens;
    cacheRead += t.cacheReadTokens; cacheCreation += t.cacheCreationTokens; cost += t.costUsdMillicents;
    if (t.reasoningTokens != null) reasoning = (reasoning ?? 0) + t.reasoningTokens;
    return {
      turnIndex: t.turnIndex,
      at: t.createdAt instanceof Date ? t.createdAt.toISOString() : String(t.createdAt),
      model: t.model,
      role: t.role,
      calls: t.calls,
      tokens: {
        prompt: t.promptTokens, completion: t.completionTokens,
        cacheRead: t.cacheReadTokens, cacheCreation: t.cacheCreationTokens, reasoning: t.reasoningTokens,
      },
      costUsd: millicentsToUsd(t.costUsdMillicents),
      byo: t.byo,
      toolSchemaTokens: t.toolSchemaTokens,
      categories: readContextCategories(t.context),
    };
  });
  return {
    executionId,
    outcome,
    totals: {
      turns: calls,
      promptTokens: prompt,
      completionTokens: completion,
      cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation,
      reasoningTokens: reasoning,
      costUsd: millicentsToUsd(cost),
      cacheHitRate: ratio(cacheRead, prompt),
    },
    turns: out,
    estimatedFields: ['toolSchemaTokens', 'categories'],
    truncated: turns.length >= limit,
  };
}
