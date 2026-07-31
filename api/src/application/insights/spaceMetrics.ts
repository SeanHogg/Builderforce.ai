/**
 * SPACE metrics lens — the developer-productivity framework that complements DORA.
 *
 * SPACE (Forsgren et al.) deliberately spans FIVE dimensions because no single
 * metric captures productivity. We compute each as a 0..100 score from signals
 * already collected — no new instrumentation — and document the PROXY used for
 * each dimension (productivity is multi-dimensional; these proxies are the best
 * available signal in our data model, not a definition of the dimension):
 *
 *   S — Satisfaction & well-being:  member engagement score (member_metrics_period
 *       engagement_score, human board-health) as a satisfaction proxy. DevEx survey
 *       data, when present, would override this — absent it the score is null.
 *   P — Performance:                deployment success rate (1 − change-failure-rate)
 *       from deployment_events — outcome quality of the work shipped.
 *   A — Activity:                   AI-run + task-completion volume normalised to the
 *       window (run_model_outcomes + tasks) — counts of output.
 *   C — Communication & collab.:    cross-member collaboration breadth proxied by the
 *       number of DISTINCT active members and PR/merge throughput (run_model_outcomes
 *       merged) — work flowing between people, not siloed.
 *   E — Efficiency & flow:          low rework + fast cycle time + low step-count per
 *       AI run (member_metrics_period cycle/rework + run_model_outcomes steps) —
 *       getting to done with minimal friction.
 *
 * The pure summarizer ({@link summarizeSpace}) takes already-fetched aggregates so
 * it is unit-testable without a DB; the route caches the live computation.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  deploymentEvents,
  memberMetricsPeriod,
  projects,
  runModelOutcomes,
  tasks,
} from '../../infrastructure/database/schema';
import { clampScore as clamp } from '../../domain/shared/numbers';
import { notSystemTask } from '../task/taskScope';

const HOUR_MS = 3_600_000;

export interface SpaceDimension {
  /** 0..100, or null when there is no signal for the dimension. */
  score: number | null;
  /** Supporting figures behind the score (rendered as a small table). */
  figures: Record<string, number | null>;
}

export interface SpaceMetrics {
  windowDays: number;
  /** Satisfaction & well-being. null when no engagement signal exists. */
  satisfaction: { score: number | null; n: number };
  performance: SpaceDimension;
  activity: SpaceDimension;
  communication: SpaceDimension;
  efficiency: SpaceDimension;
}

/** Already-fetched aggregates the pure summarizer scores. All counts are window-scoped. */
export interface SpaceAggregates {
  windowDays: number;
  /** member_metrics_period (human members) — engagement, cycle, rework. */
  engagementScores: number[];      // 0..100 per member (humans only)
  avgCycleTimeHours: number | null; // weighted avg across members
  reworkRate: number | null;        // (redo + reopen) / completed
  /** distinct members active in the window (any kind) — collaboration breadth. */
  activeMembers: number;
  /** deployment_events. */
  totalDeployments: number;
  failedDeployments: number;
  /** run_model_outcomes. */
  totalRuns: number;
  mergedRuns: number;
  avgSteps: number | null;
  /** tasks completed in window. */
  completedTasks: number;
}

const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Pure: turn fetched aggregates into the five SPACE dimension scores. */
export function summarizeSpace(a: SpaceAggregates): SpaceMetrics {
  // S — Satisfaction: mean human engagement score (already 0..100). Null = no signal.
  const satScore = avg(a.engagementScores);

  // P — Performance: deployment success rate. Null when nothing shipped.
  const perfScore = a.totalDeployments > 0
    ? clamp(((a.totalDeployments - a.failedDeployments) / a.totalDeployments) * 100)
    : null;

  // A — Activity: throughput normalised to the window. ~1 unit/day of combined
  //     AI runs + completed tasks scores 100; saturates so a busy tenant pins high.
  const perDay = a.windowDays > 0 ? (a.totalRuns + a.completedTasks) / a.windowDays : 0;
  const activityScore = a.totalRuns + a.completedTasks > 0 ? clamp(perDay * 100) : null;

  // C — Communication & collaboration: breadth (distinct active members) × flow
  //     (merge rate). 5+ active members = full breadth; weighted with merge rate so
  //     a team that ships together scores higher than a busy silo.
  const mergeRate = a.totalRuns > 0 ? (a.mergedRuns / a.totalRuns) * 100 : null;
  const breadthScore = clamp((a.activeMembers / 5) * 100);
  const commScore = a.activeMembers > 0
    ? clamp(mergeRate == null ? breadthScore : breadthScore * 0.5 + mergeRate * 0.5)
    : null;

  // E — Efficiency & flow: start at 100, dock for rework, slow cycle, high step-count.
  //     ~30pts max for full rework, ~1pt/8h cycle (cap 30), ~1pt per step over 20 (cap 20).
  let effScore: number | null = null;
  if (a.reworkRate != null || a.avgCycleTimeHours != null || a.avgSteps != null) {
    const reworkPenalty = a.reworkRate == null ? 0 : Math.min(30, a.reworkRate * 30);
    const cyclePenalty = a.avgCycleTimeHours == null ? 0 : Math.min(30, a.avgCycleTimeHours / 8);
    const stepPenalty = a.avgSteps == null ? 0 : Math.min(20, Math.max(0, a.avgSteps - 20));
    effScore = clamp(100 - reworkPenalty - cyclePenalty - stepPenalty);
  }

  return {
    windowDays: a.windowDays,
    satisfaction: { score: satScore, n: a.engagementScores.length },
    performance: { score: perfScore, figures: { deployments: a.totalDeployments, failures: a.failedDeployments } },
    activity: { score: activityScore, figures: { runs: a.totalRuns, completedTasks: a.completedTasks, perDay: Number(perDay.toFixed(2)) } },
    communication: { score: commScore, figures: { activeMembers: a.activeMembers, mergeRatePct: mergeRate == null ? null : Number(mergeRate.toFixed(1)) } },
    efficiency: { score: effScore, figures: { reworkRate: a.reworkRate == null ? null : Number(a.reworkRate.toFixed(2)), avgCycleHours: a.avgCycleTimeHours == null ? null : Number(a.avgCycleTimeHours.toFixed(1)), avgSteps: a.avgSteps == null ? null : Number(a.avgSteps.toFixed(1)) } },
  };
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Fetch the window aggregates from existing tables, then summarize. */
export async function computeSpaceMetrics(db: Db, tenantId: number, days: number, projectId?: number): Promise<SpaceMetrics> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  // member_metrics_period is tenant-grained, so it must not be reused for a
  // selected project. At project grain derive the same flow inputs directly
  // from that project's tasks; Satisfaction remains unknown until project-
  // grained survey data exists.
  const projectTaskRows = projectId == null ? [] : await db
    .select({
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      redoCount: tasks.redoCount,
      reopenCount: tasks.reopenCount,
      assignedUserId: tasks.assignedUserId,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedAgentRef: tasks.assignedAgentRef,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.projectId, projectId),
      eq(tasks.archived, false),
      gte(tasks.updatedAt, since),
      notSystemTask,
    ));

  // S/E — member_metrics_period: most-recent snapshot per member overlapping the
  // window. Engagement (humans) for Satisfaction; cycle + rework for Efficiency.
  const memberRows = projectId != null ? [] : await db
    .select({
      memberKind: memberMetricsPeriod.memberKind,
      engagementScore: memberMetricsPeriod.engagementScore,
      avgCycleTimeHours: memberMetricsPeriod.avgCycleTimeHours,
      completedCount: memberMetricsPeriod.completedCount,
      redoCount: memberMetricsPeriod.redoCount,
      reopenCount: memberMetricsPeriod.reopenCount,
    })
    .from(memberMetricsPeriod)
    .where(and(eq(memberMetricsPeriod.tenantId, tenantId), gte(memberMetricsPeriod.periodEnd, since)));

  const engagementScores = memberRows
    .filter((r) => r.engagementScore != null)
    .map((r) => num(r.engagementScore));
  let cycleWeighted = 0, cycleWeight = 0, completed = 0, rework = 0;
  for (const r of memberRows) {
    if (r.avgCycleTimeHours != null && r.completedCount > 0) {
      cycleWeighted += num(r.avgCycleTimeHours) * r.completedCount;
      cycleWeight += r.completedCount;
    }
    completed += r.completedCount;
    rework += (r.redoCount ?? 0) + (r.reopenCount ?? 0);
  }
  if (projectId != null) {
    cycleWeighted = 0;
    cycleWeight = 0;
    completed = 0;
    rework = 0;
    for (const row of projectTaskRows) {
      if (row.completedAt) {
        const hours = (row.completedAt.getTime() - row.createdAt.getTime()) / HOUR_MS;
        if (hours >= 0) { cycleWeighted += hours; cycleWeight += 1; }
        completed += 1;
      }
      rework += (row.redoCount ?? 0) + (row.reopenCount ?? 0);
    }
  }
  const avgCycleTimeHours = cycleWeight > 0 ? cycleWeighted / cycleWeight : null;
  const reworkRate = completed > 0 ? rework / completed : null;
  const activeMembers = projectId == null
    ? memberRows.length
    : new Set(projectTaskRows.flatMap((row) => row.assignedUserId
      ? [`human:${row.assignedUserId}`]
      : row.assignedAgentHostId != null
        ? [`host:${row.assignedAgentHostId}`]
        : row.assignedAgentRef ? [`agent:${row.assignedAgentRef}`] : [])).size;

  // P — deployment_events: total + failures in the window.
  const [deployAgg] = await db
    .select({
      total: sql<string>`count(*)`,
      failed: sql<string>`coalesce(sum(case when ${deploymentEvents.isFailure} then 1 else 0 end),0)`,
    })
    .from(deploymentEvents)
    .where(and(
      eq(deploymentEvents.tenantId, tenantId),
      ...(projectId != null ? [eq(deploymentEvents.projectId, projectId)] : []),
      gte(deploymentEvents.deployedAt, since),
    ));

  // A/C/E — run_model_outcomes: runs, merged, avg steps in the window.
  const [runAgg] = await db
    .select({
      total: sql<string>`count(*)`,
      merged: sql<string>`coalesce(sum(case when ${runModelOutcomes.merged} then 1 else 0 end),0)`,
      avgSteps: sql<string>`coalesce(avg(${runModelOutcomes.steps}),0)`,
    })
    .from(runModelOutcomes)
    .where(and(
      eq(runModelOutcomes.tenantId, tenantId),
      ...(projectId != null ? [eq(runModelOutcomes.projectId, projectId)] : []),
      gte(runModelOutcomes.createdAt, since),
    ));

  // A — tasks completed in the window (tenant-scoped via project join).
  const [taskAgg] = await db
    .select({ completed: sql<string>`count(*)` })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(projects.tenantId, tenantId),
      ...(projectId != null ? [eq(tasks.projectId, projectId)] : []),
      eq(tasks.archived, false),
      sql`${tasks.completedAt} is not null`,
      gte(tasks.completedAt, since),
      notSystemTask,
    ));

  const totalRuns = num(runAgg?.total);
  return summarizeSpace({
    windowDays: days,
    engagementScores,
    avgCycleTimeHours,
    reworkRate,
    activeMembers,
    totalDeployments: num(deployAgg?.total),
    failedDeployments: num(deployAgg?.failed),
    totalRuns,
    mergedRuns: num(runAgg?.merged),
    avgSteps: totalRuns > 0 ? num(runAgg?.avgSteps) : null,
    completedTasks: num(taskAgg?.completed),
  });
}
