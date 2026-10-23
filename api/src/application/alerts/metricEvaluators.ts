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
import { buildTenantDriftReport } from '../eval/driftReport';
import { millicentsToUsd } from '../../domain/shared/money';
import { HOUR_MS } from '../../domain/shared/time';
import { usageDatabaseOf } from '../llm/usageLedger';
import { tenantCostSummary } from '../costMetrics/costMetricsService';

/** The full set of metric keys a rule may target (kept in lockstep with the
 *  migration's CHECK-list and the schema AlertMetric type). */
export const ALERT_METRICS: readonly AlertMetric[] = [
  'token_spend_usd',
  'token_spend_pct_of_cap',
  'cost_per_merged_pr_usd',
  'dora_change_failure_rate',
  'dora_lead_time_hours',
  'ai_effectiveness_score',
  'eval_drift',
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
  const [row] = await usageDatabaseOf(db)
    .select({ mc: sql<string>`coalesce(sum(${llmUsageLog.costUsdMillicents}),0)` })
    .from(llmUsageLog)
    .where(and(...conds));
  return millicentsToUsd(Number(row?.mc ?? 0));
}

/** Cost-per-merged-PR (USD) with TRUE per-run attribution: the spend each merged run
 *  itself incurred (usage rows ⋈ run_model_outcomes by execution id) ÷ merged runs —
 *  not "all window spend ÷ merges", which charged every chat and failed run to the PRs.
 *  Null when no run merged (dividing would be meaningless, not "0 cost"). */
async function costPerMergedPrUsd(db: Db, tenantId: number, windowDays: number): Promise<number | null> {
  return (await tenantCostSummary(db, tenantId, windowDays))?.costPerMergedPrUsd ?? null;
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
      return { value: await costPerMergedPrUsd(db, tenantId, days) };

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

    default:
      return { value: null };
  }
}
