/**
 * Alert metric evaluators — the bridge between an alert RULE (a metric key) and
 * the platform's existing metric collectors.
 *
 * Each supported metric resolves to a single numeric `value` over the rule's
 * window/scope by REUSING the same compute* functions the insight lenses use
 * (no new collection): DORA, AI-effectiveness, FinOps token spend, and the
 * eval-drift report. A metric that genuinely can't be computed for the requested
 * scope returns `{ value: null }` and the sweep skips it (never fires on a gap).
 *
 * Kept deliberately small + branch-per-metric so a new metric is a new case, and
 * the comparator logic itself lives in runAlertSweep (pure + unit-tested).
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { AlertMetric } from '../../infrastructure/database/schema';
import { llmUsageLog, projects } from '../../infrastructure/database/schema';
import { computeDora } from '../metrics/workforceMetrics';
import { computeEngineeringInsights } from '../insights/engineeringInsights';
import { buildConsumptionSnapshot } from '../consumption/meters';
import { buildTenantDriftReport } from '../../presentation/routes/evalRoutes';
import { millicentsToUsd } from '../../domain/shared/money';
import { computeTrend } from '../insights/trendAnalysis';
import { METRIC_REGISTRY } from '../dashboards/metricRegistry';

const HOUR_MS = 3_600_000;

/** The full set of metric keys a rule may target (kept in lockstep with the
 *  migration's CHECK-list and the schema AlertMetric type).
 *
 *  Extended for PRD #208 (Trend Analysis):
 *    - trend_slope_<metricKey> — the least-squares slope (per-day) for any
 *      registry metric that exposes a daily series; callers create rules like
 *      "slope of Conversion Rate < -0.02" (AC3).
 *    - trend_label_<metricKey> — encoded trend transition:
 *      Accelerating=1, Steady=0, Slowing=-1, so threshold rules detect shifts
 *      (e.g. Steady→Slowing when the encoded label crosses below -0.5).
 */
export const ALERT_METRICS: readonly AlertMetric[] = [
  'token_spend_usd',
  'token_spend_pct_of_cap',
  'cost_per_merged_pr_usd',
  'dora_change_failure_rate',
  'dora_lead_time_hours',
  'ai_effectiveness_score',
  'eval_drift',
  // PRD #208 — trend observability for existing collection surfaces.
  'trend_slope_throughput',
  'trend_slope_cost_per_run',
  'trend_slope_tokens_per_run',
  'trend_label_throughput',
] as const;

export interface EvaluateMetricArgs {
  tenantId: number;
  metric: AlertMetric;
  scopeKind: string;            // tenant | project | team
  projectId?: number | null;
  teamId?: number | null;
  windowDays: number;
}

/** Sum attributed LLM spend (USD) over the window, optionally scoped to a project. */
async function tokenSpendUsd(db: Db, tenantId: number, since: Date, projectId?: number | null): Promise<number> {
  const conds = [eq(llmUsageLog.tenantId, tenantId), gte(llmUsageLog.createdAt, since)];
  if (projectId != null) conds.push(eq(llmUsageLog.projectId, projectId));
  const [row] = await db
    .select({ mc: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)` })
    .from(llmUsageLog)
    .where(and(...conds));
  return millicentsToUsd(Number(row?.mc ?? 0));
}

/** Cost-per-merged-PR (USD) = window spend / merged runs in the window. Null when
 *  there were no merged runs (dividing would be meaningless, not "0 cost"). */
async function costPerMergedPrUsd(db: Db, tenantId: number, since: Date, windowDays: number): Promise<number | null> {
  const spend = await tokenSpendUsd(db, tenantId, since);
  const eng = await computeEngineeringInsights(db, tenantId, windowDays);
  const merged = eng.byApproach.reduce((a, b) => a + Math.round((b.mergedRatePct / 100) * b.runs), 0);
  return merged > 0 ? spend / merged : null;
}

/**
 * Resolve a single numeric observation for an alert metric. Returns `{ value: null }`
 * for an uncomputable scope/metric so the sweep can skip it.
 *
 * Project/team scoping is honoured where a collector supports it (token spend is
 * project-scopable); metrics that only exist at tenant grain (DORA, eval drift,
 * AI effectiveness) are computed tenant-wide regardless of scopeKind.
 */
export async function evaluateMetric(
  db: Db,
  env: Env,
  args: EvaluateMetricArgs,
): Promise<{ value: number | null }> {
  const { tenantId, metric, windowDays } = args;
  const days = Number.isFinite(windowDays) && windowDays >= 1 && windowDays <= 365 ? Math.floor(windowDays) : 7;
  const since = new Date(Date.now() - days * 24 * HOUR_MS);
  const projectId = args.scopeKind === 'project' ? args.projectId ?? null : null;

  switch (metric) {
    case 'token_spend_usd':
      return { value: await tokenSpendUsd(db, tenantId, since, projectId) };

    case 'token_spend_pct_of_cap': {
      // Month-to-date token usage as a % of the plan's monthly token cap. Tenant
      // grain only (the cap is a tenant allowance); unlimited plan → null (skip).
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
      const snap = await buildConsumptionSnapshot(db, tenantId, monthStart, monthEnd, env);
      const meter = snap.meters.find((m) => m.key === 'ai_tokens');
      if (!meter || meter.unlimited) return { value: null };
      return { value: meter.percentUsed };
    }

    case 'cost_per_merged_pr_usd':
      return { value: await costPerMergedPrUsd(db, tenantId, since, days) };

    case 'dora_change_failure_rate': {
      const dora = await computeDora(db, tenantId, days);
      return { value: dora.changeFailureRatePct };
    }

    case 'dora_lead_time_hours': {
      const dora = await computeDora(db, tenantId, days);
      return { value: dora.leadTimeHours };
    }

    case 'ai_effectiveness_score': {
      const eng = await computeEngineeringInsights(db, tenantId, days);
      // No runs in the window → no score to alert on.
      return { value: eng.totals.runs > 0 ? eng.totals.avgScore : null };
    }

    case 'eval_drift': {
      // Count of drifting (action_type, model) groups; >0 means a regression.
      const report = await buildTenantDriftReport(db, tenantId);
      return { value: report.drifting.length };
    }

    // PRD #208 — Trend metric evaluators
    // Map alert metric keys to registry keys and compute trend using the trendAnalysis module.
    case 'trend_slope_throughput': {
      // delivery.agentRuns → slope of agent execution volume
      const def = METRIC_REGISTRY['delivery.agentRuns'];
      if (!def?.series) return { value: null };
      const trend = await computeTrend(db, tenantId, 'delivery.agentRuns', days, 'daily');
      return { value: trend?.slope ?? null };
    }

    case 'trend_slope_tokens_per_run': {
      // ai.tokens → slope of token consumption
      const trend = await computeTrend(db, tenantId, 'ai.tokens', days, 'daily');
      return { value: trend?.slope ?? null };
    }

    case 'trend_slope_cost_per_run': {
      // Derive from finance.spend series: slope of (spend / runs)
      // Since we don't have a direct series, compute from the spend slope and run count
      const spendTrend = await computeTrend(db, tenantId, 'finance.spend', days, 'daily');
      const runTrend = await computeTrend(db, tenantId, 'delivery.agentRuns', days, 'daily');
      if (!spendTrend || !runTrend || runTrend.mean === 0) return { value: null };
      // Cost per run = spend / runs; derivative approx = (slope_spend * mean_runs - slope_runs * mean_spend) / mean_runs^2
      const costPerRunSlope = (spendTrend.slope * runTrend.mean - runTrend.slope * spendTrend.mean) / (runTrend.mean * runTrend.mean);
      return { value: costPerRunSlope };
    }

    case 'trend_label_throughput': {
      // delivery.agentRuns → encoded trend label: 1=Accelerating, 0=Steady, -1=Slowing
      const trend = await computeTrend(db, tenantId, 'delivery.agentRuns', days, 'daily');
      if (!trend) return { value: null };
      const labelMap: Record<string, number> = { Accelerating: 1, Steady: 0, Slowing: -1 };
      return { value: labelMap[trend.classification] ?? null };
    }

    default:
      return { value: null };
  }
}
