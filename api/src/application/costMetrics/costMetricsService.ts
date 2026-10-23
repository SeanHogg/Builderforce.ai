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
  COST_METRIC_GROUP_LIMIT, RUN_TURN_LIMIT, readCostMetricRows, readRunOutcome, readRunTurns,
  type CostMetricWindowSpec,
} from './costMetricsStore';
import {
  buildCostMetricsReport, buildRunCostBreakdown, toGroupMetrics,
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
  const rows = await readCostMetricRows(db, tenantId, windowDays, groupBy);
  return buildCostMetricsReport(rows, { window, windowDays, groupBy, limit: COST_METRIC_GROUP_LIMIT });
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
    `cost:metrics:t:${tenantId}:w:${window}:g:${groupBy}:v:${ver}:b:${costMetricsBucket(nowMs)}`,
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

/** Uncached: one run's per-turn breakdown. */
export async function computeRunCostBreakdown(db: Db, tenantId: number, executionId: number): Promise<RunCostBreakdown> {
  const [turns, outcome] = await Promise.all([
    readRunTurns(db, tenantId, executionId),
    readRunOutcome(db, tenantId, executionId),
  ]);
  return buildRunCostBreakdown(executionId, turns, outcome, RUN_TURN_LIMIT);
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
    `cost:run:t:${tenantId}:e:${executionId}:v:${ver}:b:${costMetricsBucket(nowMs)}`,
    () => computeRunCostBreakdown(db, tenantId, executionId),
    TTL,
  );
}
