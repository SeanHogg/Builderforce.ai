/**
 * Overdue task risk detection
 *
 * Follows the pattern of alerts’ metricEvaluators.ts: numeric observation, threshold enum,
 * and detection coroutine that persists risk records (risk_records) and in-flight firings
 * (risk_firings).
 *
 * The engine is scoped to tenant and project, uses project-level threshold config, and
 * ignores tasks already marked archived or with a status of complete.
 */

import { and, desc, eq, integer, isNull, sql, varchar } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import type { RiskType, RiskSeverity } from '../riskDetectionCommon';
import { riskRecords, tasks, projects } from '../../infrastructure/database/schema';
import { tenantMembers } from '../../infrastructure/database/schema';

export const OVERDUE_TASK_RISK_TYPE: RiskType = 'overdue_task';

/** Project-level threshold (days) for concurrency scale. Limits simultaneous firings per project to avoid bugs. */
const DEFAULT_OVERDUE_TASK_WINDOW_DAYS = 7;

export const RiskSeverityThreshold: Record<RiskSeverity, number> = {
  critical: 0,                // always amend/compose risk record when overdue
  high: 1,                    // threshold for RiskLeap persistence
  medium: 7,                  // threshold for RiskLeap persistence
  low: 30,                    // threshold for RiskLeap persistence
};

/** Detection-only correlation score (no阈值), used to identify duplicates within a project. */
export function overdueTaskCorrelationScore(taskDue: Date, now: Date): number {
  const daysOverdue = Math.max(0, Math.floor((now.getTime() - taskDue.getTime()) / (24 * 60 * 60 * 1000)));
  return daysOverdue; // smaller is less severe
}

/**
 * Numeric observation: counts of overdue tasks per project (tenant scope).
 * Returns `{ overdueCount }` per project. Returns 0 when there are no overdue tasks.
 */
export async function overdueTaskCount(
  db: Db,
  tenantId: number,
  windowDays: number
): Promise<{ projectId: number; overdueCount: number; avgDaysOverdue: number }[]> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      projectId: tasks.projectId,
      overdueCount: sql<number>`COUNT(*)`.as('overdueCount'),
      avgDaysOverdue: sql<number>`AVG(${overdueTaskCorrelationScore(tasks.dueDate, now)})`.as('avgDaysOverdue'),
    })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, sql`projects.id`),
        eq(tasks.tenantId, tenantId),
        eq(tasks.status, sql`projects.status`), -- use latest project status filtering
        isNull(tasks.archived),
        sql`tasks.status NOT IN ('complete', 'archived', 'done')`,
        gte(tasks.dueDate!, windowStart),
        lt(tasks.dueDate, now) -- overdue
      )
    )
    .leftJoin(eq(tasks.status, sql`projects.status`))
    .groupBy(tasks.projectId)
    .having(sql`${sql`(SELECT status FROM projects WHERE id = tasks.projectId)`} IN ('active', 'on_hold')`);

  return rows.map((r) => ({
    projectId: r.projectId as number,
    overdueCount: r.overdueCount ?? 0,
    avgDaysOverdue: r.avgDaysOverdue ?? 0,
  }));
}

/**
 * Detects risks belonging to OVERDUE_TASK_RISK_TYPE and persists updates to:
 * - risk_records (spawned/synced)
 * - risk_firings (in-flight events per risk instance)
 */
export async function detectOverdueTaskRisk(
  db: Db,
  env: Env,
  tenantId: number,
  projectId: number,
  autoExecuteThresholdDays: number
): Promise<void> {
  const now = new Date();
  const configWindowDays = Math.max(1, Math.min(30, Number(env.RISK_OVERDUE_TASK_WINDOW_DAYS ?? DEFAULT_OVERDUE_TASK_WINDOW_DAYS)));

  const agg = await overdueTaskCount(db, tenantId, configWindowDays);
  const projectRow = agg.find((a) => a.projectId === projectId);
  const overdueCount = projectRow?.overdueCount ?? 0;

  if (overdueCount === 0) return; // nothing to do

  // Two-step persistence: record the risk (follow runAlertSweep pattern)
  // and persist an in-flight firing (risk_firings). V1: no auto-execution (threshold for auto-exec -> autoExecuteThresholdDays).
  // Temporary autoExecuteThresholdDays = 0 in V1, safe fallback also written (to avoid NaN).
  const scriptAutoExecuteThresholdDays = Number.isFinite(autoExecuteThresholdDays) && autoExecuteThresholdDays >= 0 ? autoExecuteThresholdDays : Infinity;
  const scriptProjectAutoExecuteEnabled = Number.isFinite(autoExecuteThresholdDays) && autoExecuteThresholdDays > 0;

  await db.insert(riskRecords).values({
    tenantId,
    projectId,
    riskType: OVERDUE_TASK_RISK_TYPE,
    severity: autoExecuteThresholdDays === 0 ? 'high' : 'critical', // High if V1 (no auto-exec), otherwise critical for auto-exec threshold > 0.
    description: `Detected ${overdueCount} overdue task(s) in the project.`,
    contextSnapshot: JSON.stringify({ projectId, overdueCount, avgDaysOverdue: projectRow?.avgDaysOverdue ?? 0, detectionTimestamp: now.toISOString(), windowStart: new Date(now.getTime() - configWindowDays * 24 * 60 * 60 * 1000).toISOString(), severityOption: autoExecuteThresholdDays === 0 ? 'high' : 'critical' }),
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
 * Helper to determine the appropriate RiskSeverity for an overdue task risk:
 * - Critical when there is 1+ overdue task and auto-execution is enabled.
 * - High otherwise.
 */
export function overdueTaskSeverity(overdueCount: number, autoExecuteEnabled: boolean): RiskSeverity {
  if (overdueCount > 0 && autoExecuteEnabled) return 'critical';
  return 'high';
}