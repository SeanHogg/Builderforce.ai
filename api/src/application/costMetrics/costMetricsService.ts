/**
 * The A4 cost-metrics use cases behind `/api/cost/*` — read, shape, cache.
 *
 * CACHE KEY: `outcomesVersionKey` (bumped by the run scorer whenever a scored run lands)
 * plus a 5-minute time bucket. NOT a per-usage-write version bump, deliberately: every
 * LLM call on every surface writes a usage row, so bumping a KV version token per write
 * would hit KV's one-write-per-second-per-key limit on any busy tenant (the bump would
 * 429 and retry on the hot logging path) and would invalidate the cache faster than a
 * dashboard reads it — a cache with a ~0% hit rate. The run-level figures (turns per
 * completed run, cost per merged PR) change only when an outcome lands, which the
 * outcomes token captures exactly; the token-level ratios move smoothly, so a bounded
 * 5-minute staleness is the honest trade.
 */
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getCacheVersion, getOrSetCached, outcomesVersionKey } from '../../infrastructure/cache/readThroughCache';
import { COST_METRIC_WINDOWS, type CostMetricGroupBy, type CostMetricWindow } from './costMetricGroups';
import {
  COST_METRIC_GROUP_LIMIT, RUN_TURN_LIMIT, readCostMetricRows, readRunBudgetInputs, readRunOutcome, readRunTurns,
  readServedWithoutModel, type CostMetricWindowSpec,
} from './costMetricsStore';
import { resolveTenantEffectivePlan } from '../tenant/tenantPlanSnapshot';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import {
  buildCostMetricsReport, buildRunBudget, buildRunCostBreakdown, toGroupMetrics,
  type CostGroupMetrics, type CostMetricsReport, type RunCostBreakdown,
} from './costMetricsShape';

/** Width of the staleness bucket folded into every key (see the module note). */
export const COST_METRICS_BUCKET_MS = 5 * 60_000;
const TTL = { kvTtlSeconds: 600, l1TtlMs: 60_000 };

export const costMetricsBucket = (nowMs: number): number => Math.floor(nowMs / COST_METRICS_BUCKET_MS);

/** Uncached: the window's metrics for one grouping. Shared by the route and the alert/registry readers. */
export async function computeCostMetrics(
  db: Db,
  tenantId: number,
  window: CostMetricWindow,
  groupBy: CostMetricGroupBy,
): Promise<CostMetricsReport> {
  const windowDays = COST_METRIC_WINDOWS[window];
  const [rows, served] = await Promise.all([
    readCostMetricRows(db, tenantId, windowDays, groupBy),
    readServedWithoutModel(db, tenantId, windowDays),
  ]);
  return buildCostMetricsReport(rows, { window, windowDays, groupBy, limit: COST_METRIC_GROUP_LIMIT, served });
}

export async function getCostMetrics(
  db: Db,
  env: Env,
  tenantId: number,
  window: CostMetricWindow,
  groupBy: CostMetricGroupBy,
  nowMs: number = Date.now(),
): Promise<CostMetricsReport> {
  const ver = await getCacheVersion(env, outcomesVersionKey(tenantId));
  return getOrSetCached(
    env,
    `cost:metrics:v2:t:${tenantId}:w:${window}:g:${groupBy}:v:${ver}:b:${costMetricsBucket(nowMs)}`,
    () => computeCostMetrics(db, tenantId, window, groupBy),
    TTL,
  );
}

/**
 * The tenant-wide figures over an arbitrary window — for readers that pluck one number
 * (an alert rule's metric, a dashboard widget) and carry their own window. Null when the
 * window holds no usage. Uncached: both callers cache their resolved values.
 */
export async function tenantCostSummary(db: Db, tenantId: number, window: CostMetricWindowSpec): Promise<CostGroupMetrics | null> {
  const [row] = await readCostMetricRows(db, tenantId, window, 'none');
  return row ? toGroupMetrics(row) : null;
}

/** The tenant's effective plan for the budget's plan default - null (so `default`) when unreadable. */
async function planForBudget(env: Env | undefined, db: Db, tenantId: number): Promise<string | null> {
  try {
    return await resolveTenantEffectivePlan(env, tenantId, db);
  } catch (error) {
    reportCaughtError(error, { source: 'application/costMetrics/costMetricsService.ts', operation: 'planForBudget', context: { tenantId }, level: 'warning' });
    return null;
  }
}

/** Uncached: one run's per-turn breakdown and its budget. */
export async function computeRunCostBreakdown(db: Db, tenantId: number, executionId: number, env?: Env): Promise<RunCostBreakdown> {
  const [turns, outcome, budgetInputs, plan] = await Promise.all([
    readRunTurns(db, tenantId, executionId),
    readRunOutcome(db, tenantId, executionId),
    readRunBudgetInputs(db, tenantId, executionId),
    planForBudget(env, db, tenantId),
  ]);
  return buildRunCostBreakdown(executionId, turns, outcome, RUN_TURN_LIMIT, buildRunBudget(budgetInputs, plan));
}

export async function getRunCostBreakdown(
  db: Db,
  env: Env,
  tenantId: number,
  executionId: number,
  nowMs: number = Date.now(),
): Promise<RunCostBreakdown> {
  const ver = await getCacheVersion(env, outcomesVersionKey(tenantId));
  return getOrSetCached(
    env,
    `cost:run:v2:t:${tenantId}:e:${executionId}:v:${ver}:b:${costMetricsBucket(nowMs)}`,
    () => computeRunCostBreakdown(db, tenantId, executionId, env),
    TTL,
  );
}
