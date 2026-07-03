/**
 * Builder-level Insights — a small, cheap, real-time snapshot the gateway can
 * push to the IDE / CLI (the missing "push surface" over data we already have:
 * the token ledger, the resolved model, cost-per-merged-PR).
 *
 * This module is intentionally self-contained and uses only bounded queries so
 * it is safe to recompute every ~30s for an SSE tick. The pure helpers
 * ({@link computePctOfCap}, {@link pickTip}) are unit-tested in
 * `builderInsights.test.ts`.
 */
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { llmUsageLog } from '../../infrastructure/database/schema';
import { utcDayStart } from '../llm/tokenUsage';
import { resolveTenantPlan } from '../../presentation/routes/llmRoutes';
import { resolveTokenLimits } from '../../domain/tenant/PlanLimits';
import { TenantPlan } from '../../domain/shared/types';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';

/** millicents → USD (mirrors `mcToUsd` in dashboardRoutes). */
const MILLICENTS_PER_USD = 100_000;

/**
 * A few models that are notably more expensive than a free coder. When today's
 * top model is one of these AND the tenant has a free coder available, we nudge
 * toward the cheaper option. Kept tiny + deterministic — no catalog lookup.
 */
const EXPENSIVE_MODELS: ReadonlyArray<string> = [
  'anthropic/claude-opus-4',
  'anthropic/claude-opus-4-1',
  'openai/gpt-4o',
  'openai/o1',
  'openai/o3',
];

/** The cheaper coder we point people at when the top model is expensive. */
const SUGGESTED_CHEAPER_CODER = 'a cheaper coding model';

export interface BuilderInsightsSnapshot {
  generatedAt: string;
  windowLabel: string;
  todayTokens: number;
  todayCostUsd: number;
  dailyCapTokens: number | null;
  pctOfDailyCap: number | null;
  topModel: { model: string; tokens: number } | null;
  costPerMergedPrUsd: number | null;
  tip: string | null;
}

function toTenantPlan(ep: 'free' | 'pro' | 'teams'): TenantPlan {
  if (ep === 'pro') return TenantPlan.PRO;
  if (ep === 'teams') return TenantPlan.TEAMS;
  return TenantPlan.FREE;
}

/**
 * Pure: pct of the daily cap used (0–999, rounded to 0.1). Null when there is no
 * positive cap (unlimited / unknown). Clamped at the low end to 0.
 */
export function computePctOfCap(todayTokens: number, dailyCapTokens: number | null): number | null {
  if (dailyCapTokens == null || dailyCapTokens <= 0) return null;
  const pct = (todayTokens / dailyCapTokens) * 100;
  if (!Number.isFinite(pct) || pct < 0) return 0;
  return Math.round(pct * 10) / 10;
}

/**
 * Pure: choose a short, deterministic tip (no LLM). Priority:
 *   1. >80% of the daily cap → warn about the cap.
 *   2. top model is a known-expensive model → suggest a cheaper coder.
 *   3. otherwise no tip.
 */
export function pickTip(input: {
  pctOfDailyCap: number | null;
  topModel: { model: string; tokens: number } | null;
}): string | null {
  if (input.pctOfDailyCap != null && input.pctOfDailyCap > 80) {
    return 'Approaching daily token cap';
  }
  const model = input.topModel?.model;
  if (model && EXPENSIVE_MODELS.some((m) => model.includes(m) || model === m)) {
    return `${model} is expensive — consider ${SUGGESTED_CHEAPER_CODER} for routine coding`;
  }
  return null;
}

/**
 * Build the snapshot from real ledger data. Bounded: two grouped scans of
 * `llm_usage_log` over today + a single plan lookup. No slow joins.
 */
export async function buildBuilderInsightsSnapshot(
  db: Db,
  env: Env,
  scope: { tenantId: number; userId: string | null; projectId?: number | null },
): Promise<BuilderInsightsSnapshot> {
  const dayStart = utcDayStart();
  const filters = [eq(llmUsageLog.tenantId, scope.tenantId), gte(llmUsageLog.createdAt, dayStart)];
  if (scope.userId) filters.push(eq(llmUsageLog.userId, scope.userId));
  // Project scope (0103 stamps project_id on run spend): narrows every metric to
  // one project's ledger. The daily cap stays the tenant/user budget, so
  // pctOfDailyCap reads as "this project used X% of your daily cap".
  if (scope.projectId != null) filters.push(eq(llmUsageLog.projectId, scope.projectId));
  const where = and(...filters);

  // Today's totals + the top model, in two bounded grouped scans.
  const [totalsRow] = await db
    .select({
      tokens: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)`,
      costMc: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}), 0)`,
    })
    .from(llmUsageLog)
    .where(where);

  const [topModelRow] = await db
    .select({
      model: llmUsageLog.model,
      tokens: sql<string>`coalesce(sum(${llmUsageLog.totalTokens}), 0)`,
    })
    .from(llmUsageLog)
    .where(where)
    .groupBy(llmUsageLog.model)
    .orderBy(desc(sql`sum(${llmUsageLog.totalTokens})`))
    .limit(1);

  const todayTokens = Number(totalsRow?.tokens ?? 0);
  const todayCostUsd = Number(totalsRow?.costMc ?? 0) / MILLICENTS_PER_USD;

  const topModel =
    topModelRow && topModelRow.model
      ? { model: topModelRow.model, tokens: Number(topModelRow.tokens ?? 0) }
      : null;

  // Resolve the tenant's effective daily token cap (-1 / 0 → unlimited → null).
  const plan = await resolveTenantPlan(env, scope.tenantId);
  const { dailyLimit } = resolveTokenLimits({
    effectivePlan: toTenantPlan(plan.effectivePlan),
    tokenDailyLimitOverride: plan.tokenDailyLimitOverride,
  });
  const dailyCapTokens = dailyLimit > 0 ? dailyLimit : null;
  const pctOfDailyCap = computePctOfCap(todayTokens, dailyCapTokens);

  // Cost-per-merged-PR: bounded — count today's merged outcomes and divide
  // today's spend by them. Scoped to the same project when one is selected so
  // the ratio matches the project-scoped spend above.
  const costPerMergedPrUsd = await computeCostPerMergedPrToday(
    db,
    scope.tenantId,
    dayStart,
    todayCostUsd,
    scope.projectId ?? null,
  );

  const tip = pickTip({ pctOfDailyCap, topModel });

  return {
    generatedAt: new Date().toISOString(),
    windowLabel: 'today',
    todayTokens,
    todayCostUsd: Math.round(todayCostUsd * 1e6) / 1e6,
    dailyCapTokens,
    pctOfDailyCap,
    topModel,
    costPerMergedPrUsd: costPerMergedPrUsd == null ? null : Math.round(costPerMergedPrUsd * 1e6) / 1e6,
    tip,
  };
}

/**
 * Bounded cost-per-merged-PR for today: today's spend / today's merged runs.
 * Returns null when there are no merged runs today. Imported lazily to avoid a
 * hard dependency on the schema shape at module load if the table moves.
 */
async function computeCostPerMergedPrToday(
  db: Db,
  tenantId: number,
  dayStart: Date,
  todayCostUsd: number,
  projectId: number | null,
): Promise<number | null> {
  const { runModelOutcomes } = await import('../../infrastructure/database/schema');
  const filters = [eq(runModelOutcomes.tenantId, tenantId), gte(runModelOutcomes.createdAt, dayStart)];
  if (projectId != null) filters.push(eq(runModelOutcomes.projectId, projectId));
  const [agg] = await db
    .select({
      merged: sql<string>`coalesce(sum(case when ${runModelOutcomes.merged} then 1 else 0 end), 0)`,
    })
    .from(runModelOutcomes)
    .where(and(...filters));
  const mergedRuns = Number(agg?.merged ?? 0);
  return mergedRuns > 0 ? todayCostUsd / mergedRuns : null;
}

/**
 * Cache key for the plain GET. The hour bucket bounds staleness even if the KV
 * TTL is missed, and keeps the key tenant+user scoped.
 */
export function builderInsightsCacheKey(
  tenantId: number,
  userId: string | null,
  projectId?: number | null,
): string {
  const hourBucket = Math.floor(Date.now() / 3_600_000);
  return `builder-insights:t:${tenantId}:u:${userId ?? '-'}:p:${projectId ?? '-'}:${hourBucket}`;
}

/** The cached loader the plain GET route uses. */
export async function getCachedBuilderInsightsSnapshot(
  db: Db,
  env: Env,
  scope: { tenantId: number; userId: string | null; projectId?: number | null },
): Promise<BuilderInsightsSnapshot> {
  return getOrSetCached(
    env,
    builderInsightsCacheKey(scope.tenantId, scope.userId, scope.projectId),
    () => buildBuilderInsightsSnapshot(db, env, scope),
    { kvTtlSeconds: 30, l1TtlMs: 15_000 },
  );
}
