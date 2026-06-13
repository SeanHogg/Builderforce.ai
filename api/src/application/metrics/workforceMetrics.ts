/**
 * Workforce effectiveness / engagement + DORA aggregation — the read half of the
 * metrics layer (migrations 0117/0118). Turns the transition log, the task
 * lifecycle columns, deployment_events, and git activity_events into:
 *
 *  - per-member scorecards (humans AND agents): throughput, redo, reopen, cycle
 *    time, and — for humans — pickup latency, idle-after-done, board hygiene,
 *    rolled into engagement + effectiveness scores.
 *  - the four DORA metrics (deployment frequency, lead time, change-failure rate,
 *    MTTR) at tenant grain.
 *
 * Scoring lives in pure functions ({@link scoreMembers}, {@link rollupDora}) so it
 * is unit-testable without a DB. Heuristic weights are documented inline and
 * clamped to [0,100].
 */
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import {
  agentHosts,
  deploymentEvents,
  projects,
  tasks,
  taskStatusTransitions,
  users,
} from '../../infrastructure/database/schema';

const HOUR_MS = 3_600_000;
/** Hard cap on tasks scanned per scorecard window — guards the JS-side
 *  aggregation against an unbounded result set on a very large tenant. The newest
 *  rows in the window are kept (ordered by updatedAt desc); a tenant that exceeds
 *  this in one window is exceptional and the cap keeps the cached read bounded. */
const MAX_METRIC_ROWS = 5_000;

// ── cache (version-token keyed: the window keyspace is unbounded, so bump a
//    per-tenant token on every status/deploy write rather than deleting each
//    window — mirrors reportRoutes' completed-by-assignee cache convention) ────
function versionKey(tenantId: number): string { return `workforce-metrics:ver:tenant:${tenantId}`; }
export function memberMetricsCacheKey(tenantId: number, version: number, days: number): string {
  return `workforce-metrics:members:tenant:${tenantId}:v:${version}:days:${days}`;
}
export function doraCacheKey(tenantId: number, version: number, days: number): string {
  return `workforce-metrics:dora:tenant:${tenantId}:v:${version}:days:${days}`;
}
export async function readWorkforceMetricsVersion(env: Env, tenantId: number): Promise<number> {
  return getOrSetCached(env, versionKey(tenantId), async () => 0, { kvTtlSeconds: 86_400 });
}
/** Bump the per-tenant token so every window-keyed scorecard/DORA entry ages out.
 *  Called from the status-transition + deployment write paths. */
export async function bumpWorkforceMetricsVersion(env: Env, tenantId: number): Promise<void> {
  const key = versionKey(tenantId);
  const current = await readWorkforceMetricsVersion(env, tenantId);
  await invalidateCached(env, key);
  await getOrSetCached(env, key, async () => current + 1, { kvTtlSeconds: 86_400 });
}

// ── member identity (mirrors reportRoutes.groupCompletedByAssignee precedence) ─
export type MemberKind = 'human' | 'cloud_agent' | 'host_agent';

export interface MemberTaskRow {
  taskId: number;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedAgentHostId: number | null;
  assignedHostName: string | null;
  assignedAgentRef: string | null;
  createdAt: Date;
  completedAt: Date | null;
  lastWorkedAt: Date | null;
  redoCount: number;
  reopenCount: number;
}

interface Identity { kind: MemberKind; ref: string; name: string; }

/** Resolve the single owner of a task (human > agent host > cloud agent). Returns
 *  null for an unassigned task (excluded from member scorecards). */
function identityOf(r: MemberTaskRow): Identity | null {
  if (r.assignedUserId) return { kind: 'human', ref: r.assignedUserId, name: r.assignedUserName || r.assignedUserId };
  if (r.assignedAgentHostId != null) return { kind: 'host_agent', ref: String(r.assignedAgentHostId), name: r.assignedHostName || `Agent host #${r.assignedAgentHostId}` };
  if (r.assignedAgentRef) return { kind: 'cloud_agent', ref: r.assignedAgentRef, name: r.assignedAgentRef };
  return null;
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface MemberScorecard {
  memberKind: MemberKind;
  memberRef: string;
  memberName: string;
  assignedCount: number;
  completedCount: number;
  redoCount: number;
  reopenCount: number;
  avgCycleTimeHours: number | null;
  avgPickupLatencyHours: number | null;
  avgIdleAfterDoneHours: number | null;
  boardHygieneScore: number | null;
  engagementScore: number | null;
  effectivenessScore: number | null;
}

/**
 * Pure scoring. `firstMoveByTask` maps taskId → the first real lane move
 * (occurredAt) used for pickup latency. Engagement dimensions are human-only;
 * agents get null engagement/hygiene (no board behaviour to keep honest) but a
 * full effectiveness score.
 */
export function scoreMembers(rows: MemberTaskRow[], firstMoveByTask: Map<number, Date>): MemberScorecard[] {
  const byMember = new Map<string, { id: Identity; rows: MemberTaskRow[] }>();
  for (const r of rows) {
    const id = identityOf(r);
    if (!id) continue;
    const key = `${id.kind}:${id.ref}`;
    const bucket = byMember.get(key) ?? { id, rows: [] };
    bucket.rows.push(r);
    byMember.set(key, bucket);
  }

  const out: MemberScorecard[] = [];
  for (const { id, rows: mrows } of byMember.values()) {
    const completed = mrows.filter((r) => r.completedAt != null);
    const redo = completed.reduce((a, r) => a + (r.redoCount || 0), 0);
    const reopen = completed.reduce((a, r) => a + (r.reopenCount || 0), 0);

    const cycleHrs = completed
      .map((r) => (r.completedAt!.getTime() - r.createdAt.getTime()) / HOUR_MS)
      .filter((h) => h >= 0);
    const idleHrs = completed
      .filter((r) => r.lastWorkedAt != null)
      .map((r) => (r.completedAt!.getTime() - r.lastWorkedAt!.getTime()) / HOUR_MS)
      .filter((h) => h >= 0);
    const pickupHrs = mrows
      .map((r) => {
        const fm = firstMoveByTask.get(r.taskId);
        return fm ? (fm.getTime() - r.createdAt.getTime()) / HOUR_MS : null;
      })
      .filter((h): h is number => h != null && h >= 0);

    const avgCycle = avg(cycleHrs);
    const avgIdle = avg(idleHrs);
    const avgPickup = avg(pickupHrs);
    const completedN = completed.length || 1;

    // Effectiveness (all): start at 100, dock for rework, reopens, slow cycle.
    const redoRate = redo / completedN;
    const reopenRate = reopen / completedN;
    const cyclePenalty = avgCycle == null ? 0 : Math.min(30, avgCycle / 8); // ~1pt per 8h, capped 30
    const effectiveness = clamp(100 - 30 * redoRate - 30 * reopenRate - cyclePenalty);

    // Engagement (humans only): board hygiene (idle-after-done) + pickup speed.
    let hygiene: number | null = null;
    let engagement: number | null = null;
    if (id.kind === 'human') {
      hygiene = avgIdle == null ? null : clamp(100 - Math.min(100, avgIdle * 4)); // ~4pt per idle hour
      const pickupScore = avgPickup == null ? null : clamp(100 - Math.min(100, avgPickup * 2)); // ~2pt per hour to pick up
      const parts = [hygiene, pickupScore].filter((p): p is number => p != null);
      engagement = parts.length ? clamp(avg(parts)!) : null;
    }

    out.push({
      memberKind: id.kind,
      memberRef: id.ref,
      memberName: id.name,
      assignedCount: mrows.length,
      completedCount: completed.length,
      redoCount: redo,
      reopenCount: reopen,
      avgCycleTimeHours: avgCycle,
      avgPickupLatencyHours: avgPickup,
      avgIdleAfterDoneHours: avgIdle,
      boardHygieneScore: hygiene,
      engagementScore: engagement,
      effectivenessScore: effectiveness,
    });
  }

  // Most effective first; stable name tiebreak.
  return out.sort((a, b) => (b.effectivenessScore ?? 0) - (a.effectivenessScore ?? 0) || a.memberName.localeCompare(b.memberName));
}

/**
 * Fetch + score every member active in the window. Tasks carry no tenant_id, so
 * scope by joining projects (same pattern as the completed-by-assignee report).
 */
export async function computeMemberMetrics(db: Db, tenantId: number, days: number): Promise<MemberScorecard[]> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  const rows = (await db
    .select({
      taskId: tasks.id,
      assignedUserId: tasks.assignedUserId,
      assignedUserName: users.displayName,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedHostName: agentHosts.name,
      assignedAgentRef: tasks.assignedAgentRef,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      lastWorkedAt: tasks.lastWorkedAt,
      redoCount: tasks.redoCount,
      reopenCount: tasks.reopenCount,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assignedUserId))
    .leftJoin(agentHosts, eq(agentHosts.id, tasks.assignedAgentHostId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      gte(tasks.updatedAt, since),
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_METRIC_ROWS)) as MemberTaskRow[];

  // First real lane move per task → pickup latency. Genesis rows (from_status
  // null) are excluded so "pickup" is the first human/agent action, not creation.
  const taskIds = rows.map((r) => r.taskId);
  const firstMove = new Map<number, Date>();
  if (taskIds.length) {
    const moves = await db
      .select({ taskId: taskStatusTransitions.taskId, occurredAt: taskStatusTransitions.occurredAt })
      .from(taskStatusTransitions)
      .where(and(inArray(taskStatusTransitions.taskId, taskIds), isNotNull(taskStatusTransitions.fromStatus)));
    for (const m of moves) {
      const prev = firstMove.get(m.taskId);
      if (!prev || m.occurredAt.getTime() < prev.getTime()) firstMove.set(m.taskId, m.occurredAt);
    }
  }

  return scoreMembers(rows, firstMove);
}

// ── DORA ─────────────────────────────────────────────────────────────────────

export interface DoraRollup {
  windowDays: number;
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;        // task createdAt → completedAt, avg
  changeFailureRatePct: number | null; // failed deploys / total deploys
  mttrHours: number | null;            // avg(restoredAt − deployedAt) over failed+restored
}

export interface DeployRow { deployedAt: Date; isFailure: boolean; restoredAt: Date | null; }

/** Pure DORA math. Separated for unit testing. */
export function rollupDora(days: number, leadTimesHrs: number[], deploys: DeployRow[]): DoraRollup {
  const total = deploys.length;
  const failures = deploys.filter((d) => d.isFailure).length;
  const mttr = deploys
    .filter((d) => d.isFailure && d.restoredAt != null)
    .map((d) => (d.restoredAt!.getTime() - d.deployedAt.getTime()) / HOUR_MS)
    .filter((h) => h >= 0);

  return {
    windowDays: days,
    deploymentFrequencyPerDay: total / days,
    totalDeployments: total,
    leadTimeHours: avg(leadTimesHrs),
    changeFailureRatePct: total ? (failures / total) * 100 : null,
    mttrHours: avg(mttr),
  };
}

export async function computeDora(db: Db, tenantId: number, days: number): Promise<DoraRollup> {
  const since = new Date(Date.now() - days * 24 * HOUR_MS);

  const deploys = (await db
    .select({ deployedAt: deploymentEvents.deployedAt, isFailure: deploymentEvents.isFailure, restoredAt: deploymentEvents.restoredAt })
    .from(deploymentEvents)
    .where(and(eq(deploymentEvents.tenantId, tenantId), gte(deploymentEvents.deployedAt, since)))) as DeployRow[];

  // Lead time: completed tasks in window, createdAt → completedAt.
  const leadRows = await db
    .select({ createdAt: tasks.createdAt, completedAt: tasks.completedAt })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      isNotNull(tasks.completedAt),
      gte(tasks.completedAt, since),
    ));
  const leadTimes = leadRows
    .map((r) => (r.completedAt!.getTime() - r.createdAt.getTime()) / HOUR_MS)
    .filter((h) => h >= 0);

  return rollupDora(days, leadTimes, deploys);
}
