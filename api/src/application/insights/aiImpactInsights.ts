/**
 * LENS — "AI Impact": the three product claims that were marketed but never
 * surfaced as a dedicated lens, computed entirely over EXISTING collectors
 * (llm_usage_log + run_model_outcomes — no new collection, no migration):
 *
 *   1. Adoption & Usage Trends — weekly buckets of active users / runs / tokens
 *      / cost, plus per-model SHARE-OF-RUNS trend (which models are gaining or
 *      losing share week-over-week).
 *   2. Multi-Tool Evaluation — a head-to-head comparison matrix of models by
 *      quality (avg score, merge rate, CI-green), efficiency (avg steps, cost
 *      per merged PR) and volume, so a leader can pick the best tool per work.
 *   3. AI Productivity Insights — a composite 0..100 "AI productivity score"
 *      blending throughput, quality and efficiency, with a week-over-week delta.
 *
 * Aggregation is pure ({@link summarizeAiImpact}) over already-fetched rows so it
 * is unit-testable without a DB; {@link computeAiImpact} does the I/O and caching
 * is owned by the route.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog, runModelOutcomes } from '../../infrastructure/database/schema';
import { MILLICENTS_PER_USD } from '../../domain/shared/money';
import { normalizeByoProvider } from '../llm/usageLedger';
import { vendorForModel } from '../llm/vendors/registry';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** A usage row, pre-projected to just what the rollup needs. */
export interface UsageRow {
  model: string;
  totalTokens: number;
  costUsdMillicents: number;
  userId: string | null;
  createdAt: Date;
  /** True when the tenant's OWN connected credential served the call. */
  byo: boolean;
  /** Connected-integration id for BYO rows. Null on rows written before 0340 (or
   *  by a path that didn't stamp it) — {@link providerForUsageRow} backfills those
   *  from the model's vendor so historical BYO spend still attributes. */
  byoProvider: string | null;
}

/** An outcome row, pre-projected to just what the rollup needs. */
export interface ImpactOutcomeRow {
  resolvedModel: string;
  score: number;
  merged: boolean;
  ciGreen: boolean;
  steps: number;
  costUsdMillicents: number;
}

/** Bucket grain for the adoption series — daily for short windows (so a 7-day
 *  trend isn't a single point), weekly for longer ones. */
export type AdoptionGrain = 'day' | 'week';

export interface AdoptionBucket {
  /** ISO date (YYYY-MM-DD) of the bucket's start (UTC), anchored to the window
   *  so buckets are stable for the requested range. */
  bucketStart: string;
  activeUsers: number;
  runs: number;
  tokens: number;
  costUsd: number;
}

export interface ModelShareTrend {
  model: string;
  /** Change in share-of-runs (percentage points) between the first and last
   *  full weeks of the window. Positive = gaining share. */
  deltaPct: number;
  /** This model's share of runs in the most recent week (0..100). */
  currentSharePct: number;
}

export interface ComparisonRow {
  model: string;
  runs: number;
  avgScore: number;        // 0..1
  mergedRatePct: number;   // 0..100
  ciGreenRatePct: number;  // 0..100
  avgSteps: number;
  /** Total cost / number of merged PRs (USD). null when nothing merged. */
  costPerMergedPrUsd: number | null;
  tokens: number;
}

/** Stable id for platform-funded spend — Builderforce's own metered keys, i.e.
 *  everything that is NOT a tenant's connected integration. */
export const PLATFORM_PROVIDER_ID = 'builderforce';

/** Token/cost consumption for one model, rolled up from `llm_usage_log` — so it
 *  covers EVERY surface (web, VSIX, on-prem, cloud, SDK), not just the scored
 *  cloud runs that {@link ComparisonRow} is limited to. */
export interface ModelConsumption {
  model: string;
  requests: number;
  tokens: number;
  /** Platform cost. 0 for models served exclusively by a tenant credential. */
  costUsd: number;
  /** True when EVERY row for this model was BYO-funded. */
  byo: boolean;
  /** Credential ids that served this model (usually one). */
  providers: string[];
}

/** Consumption grouped by the credential that FUNDED it — the tenant's connected
 *  BYO integration, or {@link PLATFORM_PROVIDER_ID} for Builderforce's own keys.
 *  This is the "consumption per integration / API key" view: BYO spend is real
 *  spend on the tenant's account even though it costs the platform nothing, so it
 *  must never be inferred from `costUsd` (which is 0 by design for BYO). */
export interface ProviderConsumption {
  provider: string;
  byo: boolean;
  requests: number;
  tokens: number;
  costUsd: number;
  /** Models served through this credential, ranked by tokens (most first). */
  models: string[];
}

export interface ProductivityScore {
  /** Composite 0..100. */
  score: number;
  /** Throughput component 0..1 (merge volume, normalized). */
  throughput: number;
  /** Quality component 0..1 (avg score blended with CI-green rate). */
  quality: number;
  /** Efficiency component 0..1 (inverse cost-per-merged-PR, normalized). */
  efficiency: number;
  /** Composite 0..100 for the PREVIOUS equal-length window. */
  prevScore: number;
  /** Week-over-window % change of the composite. */
  deltaPct: number;
}

export interface AiImpactInsights {
  windowDays: number;
  adoption: {
    /** Adoption/usage buckets at {@link AiImpactInsights.adoption.grain} grain. */
    series: AdoptionBucket[];
    grain: AdoptionGrain;
    modelShareTrend: ModelShareTrend[];
  };
  comparison: ComparisonRow[];
  /** Raw consumption straight off the usage ledger. Deliberately independent of
   *  `comparison` (which only sees scored cloud runs) so BYO / web / VSIX / on-prem
   *  usage — the majority of it for a BYO tenant — is actually visible. */
  consumption: {
    models: ModelConsumption[];
    providers: ProviderConsumption[];
    totalTokens: number;
    totalRequests: number;
    totalCostUsd: number;
    /** Tokens served by the tenant's own connected credentials. */
    byoTokens: number;
  };
  productivity: ProductivityScore;
}

/** Short windows get daily buckets; longer ones stay weekly to keep the point
 *  count readable. 14 days is the crossover (≤14 → daily, else weekly). */
export function adoptionGrainFor(windowDays: number): AdoptionGrain {
  return windowDays <= 14 ? 'day' : 'week';
}

/** UTC YYYY-MM-DD of a timestamp. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Index of the week a timestamp falls into, relative to `windowStart`. */
function weekIndex(ts: number, windowStart: number): number {
  return Math.floor((ts - windowStart) / WEEK_MS);
}

/**
 * Pure: roll usage rows into stable adoption buckets anchored at `windowStart`,
 * one bucket per elapsed day OR week (per `grain`) so the trend has consistent
 * grain regardless of how sparse a given bucket is.
 */
export function summarizeAdoption(usage: UsageRow[], windowStart: number, now: number, grain: AdoptionGrain): AdoptionBucket[] {
  const step = grain === 'day' ? DAY_MS : WEEK_MS;
  const count = Math.max(1, Math.ceil((now - windowStart) / step));
  const buckets = Array.from({ length: count }, (_, i) => ({
    start: windowStart + i * step,
    users: new Set<string>(),
    runs: 0,
    tokens: 0,
    millicents: 0,
  }));
  for (const r of usage) {
    const idx = Math.floor((r.createdAt.getTime() - windowStart) / step);
    const b = buckets[idx];
    if (!b) continue;
    if (r.userId) b.users.add(r.userId);
    b.runs += 1;
    b.tokens += r.totalTokens;
    b.millicents += r.costUsdMillicents;
  }
  return buckets.map((b) => ({
    bucketStart: isoDay(b.start),
    activeUsers: b.users.size,
    runs: b.runs,
    tokens: b.tokens,
    costUsd: b.millicents / MILLICENTS_PER_USD,
  }));
}

/**
 * Pure: per-model share-of-runs trend. Compares each model's share in the first
 * vs the last week of the window; returns models ranked by current share. Weeks
 * with no usage anchor share at 0 so a brand-new model reads as "gaining".
 */
export function summarizeModelShareTrend(usage: UsageRow[], windowStart: number, now: number): ModelShareTrend[] {
  const weeks = Math.max(1, Math.ceil((now - windowStart) / WEEK_MS));
  const lastWeek = weeks - 1;
  const firstTotals = new Map<string, number>();
  const lastTotals = new Map<string, number>();
  const windowTotals = new Map<string, number>();
  let firstTotal = 0;
  let lastTotal = 0;
  let windowTotal = 0;
  for (const r of usage) {
    const idx = weekIndex(r.createdAt.getTime(), windowStart);
    windowTotals.set(r.model, (windowTotals.get(r.model) ?? 0) + 1);
    windowTotal += 1;
    if (idx === 0) {
      firstTotals.set(r.model, (firstTotals.get(r.model) ?? 0) + 1);
      firstTotal += 1;
    }
    if (idx === lastWeek) {
      lastTotals.set(r.model, (lastTotals.get(r.model) ?? 0) + 1);
      lastTotal += 1;
    }
  }
  const models = new Set<string>([...windowTotals.keys()]);
  const trend: ModelShareTrend[] = [];
  for (const model of models) {
    const firstShare = firstTotal ? ((firstTotals.get(model) ?? 0) / firstTotal) * 100 : 0;
    const lastShare = lastTotal ? ((lastTotals.get(model) ?? 0) / lastTotal) * 100 : 0;
    // Share over the FULL window (not just the last week) so a model used early in the
    // window still shows on the donut (which drops 0%-share slices) and the donut agrees
    // with its own table; the trend ARROW stays week-over-week (first → last).
    const windowShare = windowTotal ? ((windowTotals.get(model) ?? 0) / windowTotal) * 100 : 0;
    trend.push({
      model,
      currentSharePct: windowShare,
      deltaPct: lastShare - firstShare,
    });
  }
  return trend.sort((a, b) => b.currentSharePct - a.currentSharePct);
}

/**
 * Pure: which credential funded a usage row.
 *
 * BYO rows carry their connected-integration id in `byoProvider`; rows written
 * before that column existed (0340) fall back to the model's own vendor, mapped
 * through the same alias table the integrations UI uses so the id matches what
 * the tenant sees on their provider-keys page. Platform-funded rows all collapse
 * to {@link PLATFORM_PROVIDER_ID} — the platform key is one credential.
 */
export function providerForUsageRow(row: UsageRow): string {
  if (!row.byo) return PLATFORM_PROVIDER_ID;
  return normalizeByoProvider(row.byoProvider ?? vendorForModel(row.model));
}

/**
 * Pure: token/cost consumption per model over the usage ledger, ranked by tokens.
 *
 * This is the answer to "which models are we actually using" — it counts every
 * logged row, so a tenant whose whole workload runs on their own key still sees
 * their models. Never filter this by cost: BYO rows are recorded with cost 0.
 */
export function summarizeModelConsumption(usage: UsageRow[]): ModelConsumption[] {
  const groups = new Map<string, { requests: number; tokens: number; millicents: number; byoRows: number; providers: Set<string> }>();
  for (const r of usage) {
    const g = groups.get(r.model) ?? { requests: 0, tokens: 0, millicents: 0, byoRows: 0, providers: new Set<string>() };
    g.requests += 1;
    g.tokens += r.totalTokens;
    g.millicents += r.costUsdMillicents;
    if (r.byo) g.byoRows += 1;
    g.providers.add(providerForUsageRow(r));
    groups.set(r.model, g);
  }
  return [...groups.entries()]
    .map(([model, g]) => ({
      model,
      requests: g.requests,
      tokens: g.tokens,
      costUsd: g.millicents / MILLICENTS_PER_USD,
      byo: g.byoRows === g.requests,
      providers: [...g.providers].sort(),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Pure: consumption per funding credential (connected integration or the platform
 * key), ranked by tokens — the per-integration/API-key breakdown.
 */
export function summarizeProviderConsumption(usage: UsageRow[]): ProviderConsumption[] {
  const groups = new Map<string, { byo: boolean; requests: number; tokens: number; millicents: number; models: Map<string, number> }>();
  for (const r of usage) {
    const provider = providerForUsageRow(r);
    const g = groups.get(provider) ?? { byo: r.byo, requests: 0, tokens: 0, millicents: 0, models: new Map<string, number>() };
    g.requests += 1;
    g.tokens += r.totalTokens;
    g.millicents += r.costUsdMillicents;
    g.models.set(r.model, (g.models.get(r.model) ?? 0) + r.totalTokens);
    groups.set(provider, g);
  }
  return [...groups.entries()]
    .map(([provider, g]) => ({
      provider,
      byo: g.byo,
      requests: g.requests,
      tokens: g.tokens,
      costUsd: g.millicents / MILLICENTS_PER_USD,
      models: [...g.models.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
    }))
    .sort((a, b) => b.tokens - a.tokens);
}

/**
 * Pure: head-to-head comparison matrix over outcome rows, grouped by the model
 * the run resolved onto. Sorted by run count (most-evidenced first).
 */
/** Canonical model key for joining `run_model_outcomes.resolved_model` against
 *  `llm_usage_log.model`: drop any vendor prefix (`anthropic/claude-sonnet-4-5` →
 *  `claude-sonnet-4-5`) and lowercase, so slug drift between the two tables doesn't
 *  silently yield tokens = 0. Both the map build and the lookup use it, symmetrically. */
export function canonModelKey(m: string): string {
  const base = m.includes('/') ? m.slice(m.lastIndexOf('/') + 1) : m;
  return base.toLowerCase();
}

export function summarizeComparison(outcomes: ImpactOutcomeRow[], tokensByModel: Map<string, number>): ComparisonRow[] {
  const groups = new Map<string, ImpactOutcomeRow[]>();
  for (const r of outcomes) {
    const list = groups.get(r.resolvedModel) ?? [];
    list.push(r);
    groups.set(r.resolvedModel, list);
  }
  const rows: ComparisonRow[] = [];
  for (const [model, rs] of groups) {
    const runs = rs.length;
    const merged = rs.filter((r) => r.merged).length;
    const costUsd = rs.reduce((a, r) => a + r.costUsdMillicents, 0) / MILLICENTS_PER_USD;
    rows.push({
      model,
      runs,
      avgScore: runs ? rs.reduce((a, r) => a + r.score, 0) / runs : 0,
      mergedRatePct: runs ? (merged / runs) * 100 : 0,
      ciGreenRatePct: runs ? (rs.filter((r) => r.ciGreen).length / runs) * 100 : 0,
      avgSteps: runs ? rs.reduce((a, r) => a + r.steps, 0) / runs : 0,
      costPerMergedPrUsd: merged ? costUsd / merged : null,
      tokens: tokensByModel.get(canonModelKey(model)) ?? 0,
    });
  }
  return rows.sort((a, b) => b.runs - a.runs);
}

/**
 * Pure: composite productivity components from a set of outcome rows.
 * - throughput: merged-PR volume, log-normalized so it saturates (10 merges ≈ 1).
 * - quality:    avg score blended 50/50 with CI-green rate.
 * - efficiency: inverse cost-per-merged-PR, normalized against a $5 reference.
 * Returns all three in 0..1 plus the 0..100 composite (equal-weighted).
 */
export function scoreComponents(outcomes: ImpactOutcomeRow[]): { throughput: number; quality: number; efficiency: number; score: number } {
  const runs = outcomes.length;
  const merged = outcomes.filter((r) => r.merged).length;
  const avgScore = runs ? outcomes.reduce((a, r) => a + r.score, 0) / runs : 0;
  const ciGreenRate = runs ? outcomes.filter((r) => r.ciGreen).length / runs : 0;
  const costUsd = outcomes.reduce((a, r) => a + r.costUsdMillicents, 0) / MILLICENTS_PER_USD;

  const throughput = clamp01(Math.log10(merged + 1) / Math.log10(11)); // 0 → 0, 10 → 1
  const quality = clamp01(0.5 * avgScore + 0.5 * ciGreenRate);
  // Cheaper merged PRs score higher; $0 → 1, $5+ → ~0 (reference cost = $5/PR).
  const costPerMerged = merged ? costUsd / merged : null;
  const efficiency = costPerMerged == null ? 0 : clamp01(1 - Math.min(costPerMerged, 5) / 5);

  const score = ((throughput + quality + efficiency) / 3) * 100;
  return { throughput, quality, efficiency, score };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Pure: assemble the full AiImpactInsights from already-fetched rows. `prev` is
 * the outcome set for the immediately-preceding equal-length window (for the
 * productivity delta). `windowStart`/`now` anchor the weekly buckets.
 */
export function summarizeAiImpact(
  usage: UsageRow[],
  outcomes: ImpactOutcomeRow[],
  prevOutcomes: ImpactOutcomeRow[],
  windowDays: number,
  windowStart: number,
  now: number,
): AiImpactInsights {
  const tokensByModel = new Map<string, number>();
  for (const r of usage) {
    const key = canonModelKey(r.model);
    tokensByModel.set(key, (tokensByModel.get(key) ?? 0) + r.totalTokens);
  }

  const cur = scoreComponents(outcomes);
  const prev = scoreComponents(prevOutcomes);
  const deltaPct = prev.score > 0 ? ((cur.score - prev.score) / prev.score) * 100 : (cur.score > 0 ? 100 : 0);

  const grain = adoptionGrainFor(windowDays);
  const models = summarizeModelConsumption(usage);
  return {
    windowDays,
    adoption: {
      series: summarizeAdoption(usage, windowStart, now, grain),
      grain,
      modelShareTrend: summarizeModelShareTrend(usage, windowStart, now),
    },
    comparison: summarizeComparison(outcomes, tokensByModel),
    consumption: {
      models,
      providers: summarizeProviderConsumption(usage),
      totalTokens: models.reduce((s, m) => s + m.tokens, 0),
      totalRequests: usage.length,
      totalCostUsd: models.reduce((s, m) => s + m.costUsd, 0),
      byoTokens: usage.reduce((s, r) => s + (r.byo ? r.totalTokens : 0), 0),
    },
    productivity: {
      score: cur.score,
      throughput: cur.throughput,
      quality: cur.quality,
      efficiency: cur.efficiency,
      prevScore: prev.score,
      deltaPct,
    },
  };
}

/** I/O: fetch the window (and its preceding window) and assemble the lens. */
export async function computeAiImpact(db: Db, tenantId: number, days: number): Promise<AiImpactInsights> {
  const now = Date.now();
  const windowStart = now - days * DAY_MS;
  const since = new Date(windowStart);
  const prevSince = new Date(windowStart - days * DAY_MS);

  const usage = (await db
    .select({
      model: llmUsageLog.model,
      totalTokens: llmUsageLog.totalTokens,
      costUsdMillicents: llmUsageLog.costUsdMillicents,
      userId: llmUsageLog.userId,
      createdAt: llmUsageLog.createdAt,
      byo: llmUsageLog.byo,
      byoProvider: llmUsageLog.byoProvider,
    })
    .from(llmUsageLog)
    .where(and(eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since)))) as UsageRow[];

  const outcomes = (await db
    .select({
      resolvedModel: runModelOutcomes.resolvedModel,
      score: runModelOutcomes.score,
      merged: runModelOutcomes.merged,
      ciGreen: runModelOutcomes.ciGreen,
      steps: runModelOutcomes.steps,
      costUsdMillicents: runModelOutcomes.costUsdMillicents,
    })
    .from(runModelOutcomes)
    .where(and(eq(runModelOutcomes.tenantId, tenantId), gte(runModelOutcomes.createdAt, since)))) as ImpactOutcomeRow[];

  // Preceding equal-length window — outcomes only (drives the productivity delta).
  const prevOutcomes = (await db
    .select({
      resolvedModel: runModelOutcomes.resolvedModel,
      score: runModelOutcomes.score,
      merged: runModelOutcomes.merged,
      ciGreen: runModelOutcomes.ciGreen,
      steps: runModelOutcomes.steps,
      costUsdMillicents: runModelOutcomes.costUsdMillicents,
    })
    .from(runModelOutcomes)
    .where(and(
      eq(runModelOutcomes.tenantId, tenantId),
      gte(runModelOutcomes.createdAt, prevSince),
      sql`${runModelOutcomes.createdAt} < ${since}`,
    ))) as ImpactOutcomeRow[];

  return summarizeAiImpact(usage, outcomes, prevOutcomes, days, windowStart, now);
}
