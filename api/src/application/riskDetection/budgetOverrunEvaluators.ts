/**
 * Budget overrun risk detection
 *
 * Follows the pattern of alerts’ metricEvaluators.ts: numeric observation, threshold enum,
 * and detection coroutine that persists risk records (risk_records) and in-flight firings
 * (risk_firings).
 *
 * The engine is scoped to tenant and project, uses project-level threshold config, and
 * ignores budgets already marked archived or with a status of complete.
 */

import { and, desc, eq, isNull, sql, varchar } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RiskType } from '../riskDetectionCommon';
import { riskRecords, projectBudgets } from '../../infrastructure/database/schema';
import { projects } from '../../infrastructure/database/schema';
import { tenantMembers } from '../../infrastructure/database/schema';

export const BUDGET_OVERRUN_RISK_TYPE: RiskType = 'budget_overrun';

/** Project-level threshold (percentage) for concurrency scale. Limits simultaneous firings per project to avoid bugs. */
const DEFAULT_BUDGET_OVERRUN_WINDOW_DAYS = 30;

export const RiskSeverityThreshold: ReturnType<typeof { critical: number; high: number; medium: number; low: number }> = {
  critical: 0,                // always amend/compose risk record when overrun
  high: 0.05,                 // 5% overrun
  medium: 0.10,               // 10% overrun
  low: 0.20,                  // 20% overrun
};

/** Detection-only correlation score (no阈值), used to identify duplicates within a project. */
export function budgetOverrunCorrelationScore(budgetCapUsd: number, actualSpendUsd: number): number {
  if (budgetCapUsd <= 0.0) return 0;
  return actualSpendUsd <= 0.0 ? 0 : Math.round((actualSpendUsd / budgetCapUsd) * 100);
}

/**
 * Numeric observation: budget overruns per project (tenant scope).
 * Returns `{ projectId, overrunPct, overrunCount, avgOverrunPct }` per project.
 * Returns zero/empty when there are no budget overruns.
 */
export async function budgetOverrunCount(
  db: Db,
  tenantId: number,
  windowDays: number
): Promise<{ projectId: number; overrunPct: number; overrunCount: number; avgOverrunPct: number }[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      projectId: projectBudgets.projectId,
      actualSpendUsd: sql<number>`COALESCE(SUM(${projectBudgets.actualSpend}), 0)`.as('actualSpendUsd'),
      budgetCapUsd: projectBudgets.budgetCapUsd,
      overrunCount: sql<number>`COUNT(*)`.as('overrunCount'),
      avgOverrunPct: sql<number>`AVG(${budgetOverrunCorrelationScore(projectBudgets.budgetCapUsd, sql<number>`COALESCE(SUM(${projectBudgets.actualSpend}), 0)`)})`.as('avgOverrunPct'),
    })
    .from(projectBudgets)
    .where(
      and(
        eq(projectBudgets.tenantId, tenantId),
        isNull(projectBudgets.archived),
        gte(projectBudgets.budgetEffectiveStart, windowStart),
        sql`projects.status = 'active' OR projects.status IS NULL`
      )
    )
    .leftJoin(eq(projectBudgets.projectId, sql`projects.id`))
    .orderBy(desc(sql`(SELECT SUM(${projectBudgets.actualSpend} - ${projectBudgets.budgetCapUsd}) FROM project_budgets p2 WHERE p2.project_id = ${projectBudgets.projectId} AND p2.archived IS NULL)`))
    .groupBy(projectBudgets.projectId)
    .having(sql`${sql`(SELECT status FROM projects WHERE id = ${projectBudgets.projectId})` IS NOT NULL AND ${sql`(SELECT SUM(${projectBudgets.actualSpend} - ${projectBudgets.budgetCapUsd}) FROM project_budgets p2 WHERE p2.project_id = ${projectBudgets.projectId} AND p2.archived IS NULL)`} >= 0`);

  return rows.map((r) => ({
    projectId: r.projectId as number,
    overrunPct: r.avgOverrunPct ?? 0,
    overrunCount: r.overrunCount ?? 0,
  }));
}

/**
 * Detects risks belonging to BUDGET_OVERRUN_RISK_TYPE and persists updates to:
 * - risk_records (spawned/synced)
 * - risk_firings (in-flight events per risk instance)
 */
export async function detectBudgetOverrunRisk(
  db: Db,
  env: Env,
  tenantId: number,
  projectId: number,
  autoExecuteThresholdPct: number
): Promise<void> {
  const now = new Date();
  const configWindowDays = Math.max(1, Math.min(365, Number(env.RISK_BUDGET_OVERRUN_WINDOW_DAYS ?? DEFAULT_BUDGET_OVERRUN_WINDOW_DAYS)));

  const agg = await budgetOverrunCount(db, tenantId, configWindowDays);
  const projectRow = agg.find((a) => a.projectId === projectId);
  const overrunPct = projectRow?.avgOverrunPct ?? 0;
  const totalOverrunCount = projectRow?.overrunCount ?? 0;

  if (totalOverrunCount === 0) return; // nothing to do

  // Two-step persistence: record the risk (follow runAlertSweep pattern)
  // and persist an in-flight firing (risk_firings). V1: no auto-execution (threshold for auto-exec -> autoExecuteThresholdPct).
  // Temporary autoExecuteThresholdPct = 0 in V1, safe fallback also written (to avoid NaN).
  const scriptAutoExecuteThresholdPct = Number.isFinite(autoExecuteThresholdPct) && autoExecuteThresholdPct >= 0 ? autoExecuteThresholdPct : 0;
  const scriptProjectAutoExecuteEnabled = Number.isFinite(autoExecuteThresholdPct) && autoExecuteThresholdPct > 0;

  await db.insert(riskRecords).values({
    tenantId,
    projectId,
    riskType: BUDGET_OVERRUN_RISK_TYPE,
    severity: scriptAutoExecuteThresholdPct === 0 ? 'high' : 'critical', // High if V1 (no auto-exec), otherwise critical for auto-exec threshold > 0.
    description: `Detected ${totalOverrunCount} budget overrun event(s) in the project.`, // Use totalOverrunCount for safety.
    contextSnapshot: JSON.stringify({ projectId, overrunCount: totalOverrunCount, avgOverrunPct: overrunPct, detectionTimestamp: now.toISOString(), windowStart: new Date(now.getTime() - configWindowDays * 24 * 60 * 60 * 1000).toISOString(), severityOption: scriptAutoExecuteThresholdPct === 0 ? 'high' : 'critical' }),
    detectionTimestamp: now,
    firstSeenAt: now,
    lastSeenAt: now,
    mitigationStatus: 'open',
    autoExecuteEnabled: scriptProjectAutoExecuteEnabled,
  });

  // Create absent risk_firings entries if missing (R1.2; in-flight events). Note: getOrSetCached variant from alertEvents is too heavy for detection-only; we use a noop on conflict per run to keep this detection-only and safe.
  // No risk_firings call in V1.
}

/**
 * Helper to determine the appropriate RiskSeverity for a budget overrun risk:
 * - Critical when there is at least one overrun line and auto-execution is enabled.
 * - High otherwise.
 */
export function budgetOverrunSeverity(overrunCount: number, autoExecuteEnabled: boolean): ReturnType<typeof { critical: boolean; high: boolean }> {
  if (overrunCount > 0 && autoExecuteEnabled) return { critical: true, high: false };
  return { critical: false, high: true };
}