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
  memberProfiles,
  projects,
  tasks,
  taskStatusTransitions,
  users,
} from '../../infrastructure/database/schema';
import { clampScore as clamp } from '../../domain/shared/numbers';
import { notSystemTask } from '../task/taskScope';

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

/** The polymorphic assignee columns shared by every task-grain rollup. */
export interface MemberIdentityFields {
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedAgentHostId: number | null;
  assignedHostName: string | null;
  assignedAgentRef: string | null;
}

export interface MemberTaskRow extends MemberIdentityFields {
  taskId: number;
  createdAt: Date;
  completedAt: Date | null;
  lastWorkedAt: Date | null;
  redoCount: number;
  reopenCount: number;
}

export interface Identity { kind: MemberKind; ref: string; name: string; }

/** Resolve the single owner of a task (human > agent host > cloud agent). Returns
 *  null for an unassigned task (excluded from member scorecards). Exported so every
 *  task-grain rollup (scorecards, allocation) resolves identity identically (DRY). */
export function identityOf(r: MemberIdentityFields): Identity | null {
  if (r.assignedUserId) return { kind: 'human', ref: r.assignedUserId, name: r.assignedUserName || r.assignedUserId };
  if (r.assignedAgentHostId != null) return { kind: 'host_agent', ref: String(r.assignedAgentHostId), name: r.assignedHostName || `Agent host #${r.assignedAgentHostId}` };
  if (r.assignedAgentRef) return { kind: 'cloud_agent', ref: r.assignedAgentRef, name: r.assignedAgentRef };
  return null;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface MemberScorecard {
  memberKind: MemberKind;
  memberRef: string;
  memberName: string;
  /** Builder-discipline axis (engineering | product | design | qa | devops |
   *  data | other) from member_profiles; null = unassigned. Attached in
   *  {@link computeMemberMetrics} (kept out of {@link scoreMembers} so scoring
   *  stays a pure, DB-free function). */
  discipline: string | null;
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
      discipline: null, // attached from member_profiles in computeMemberMetrics
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

// ── builder-discipline rollup (the Jellyfish "beyond engineers" lens) ──────────

export interface DisciplineRollup {
  discipline: string;
  memberCount: number;
  completedCount: number;
  avgEffectiveness: number | null;
}

/**
 * Pure: group scorecards by their builder discipline so delivery is attributable
 * to PM / design / QA / etc., not just human-vs-agent. Null disciplines fall into
 * an 'unassigned' bucket. Sorted by completed work desc (stable discipline name
 * tiebreak). Separated for unit testing (no DB).
 */
export function rollupByDiscipline(cards: MemberScorecard[]): DisciplineRollup[] {
  const byDisc = new Map<string, { count: number; completed: number; effs: number[] }>();
  for (const c of cards) {
    const key = c.discipline ?? 'unassigned';
    const b = byDisc.get(key) ?? { count: 0, completed: 0, effs: [] };
    b.count += 1;
    b.completed += c.completedCount;
    if (c.effectivenessScore != null) b.effs.push(c.effectivenessScore);
    byDisc.set(key, b);
  }
  const out: DisciplineRollup[] = [];
  for (const [discipline, b] of byDisc) {
    out.push({
      discipline,
      memberCount: b.count,
      completedCount: b.completed,
      avgEffectiveness: avg(b.effs),
    });
  }
  return out.sort((a, b) => b.completedCount - a.completedCount || a.discipline.localeCompare(b.discipline));
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
      notSystemTask,
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

  const cards = scoreMembers(rows, firstMove);

  // Attach the builder discipline from member_profiles (one query, tenant-scoped),
  // matched by the polymorphic (memberKind, memberRef) identity. Kept out of the
  // pure scorer so scoreMembers stays DB-free.
  const profileRows = await db
    .select({ memberKind: memberProfiles.memberKind, memberRef: memberProfiles.memberRef, discipline: memberProfiles.discipline })
    .from(memberProfiles)
    .where(eq(memberProfiles.tenantId, tenantId));
  const disciplineByMember = new Map<string, string>();
  for (const p of profileRows) {
    if (p.discipline) disciplineByMember.set(`${p.memberKind}:${p.memberRef}`, p.discipline);
  }
  for (const c of cards) {
    c.discipline = disciplineByMember.get(`${c.memberKind}:${c.memberRef}`) ?? null;
  }

  return cards;
}

// ── project-scoped delivery (for the project diagnostics rating) ───────────────

/** Project-level delivery signals — the project analogue of the member
 *  scorecard's delivery columns, aggregated across the project's members. */
export interface ProjectDeliveryMetrics {
  completed: number;
  avgCycleTimeHours: number | null;
  /** (redo + reopen) / completed across the project's completed tasks. */
  reworkRate: number | null;
  /** Mean board hygiene (0..100) across the project's human members. */
  boardHygieneScore: number | null;
}

/**
 * Delivery metrics for ONE project, derived live from its tasks. member_metrics_period
 * is a per-member tenant snapshot (no project grain), so the project diagnostics
 * rating computes delivery here instead — reusing {@link scoreMembers} so the
 * cycle-time / rework / hygiene formulas live in one place (DRY). Bounded by
 * MAX_METRIC_ROWS and called only behind the data-driven cache.
 */
export async function computeProjectDeliveryMetrics(db: Db, tenantId: number, projectId: number, days: number): Promise<ProjectDeliveryMetrics> {
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
      eq(tasks.projectId, projectId),
      eq(tasks.archived, false),
      gte(tasks.updatedAt, since),
      notSystemTask,
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_METRIC_ROWS)) as MemberTaskRow[];

  // Reuse the member scorer (pickup latency isn't needed here → empty firstMove),
  // then roll the per-member cards up to the project.
  const cards = scoreMembers(rows, new Map());
  let completed = 0, redo = 0, reopen = 0, cycleWeighted = 0, cycleWeight = 0;
  const hygienes: number[] = [];
  for (const c of cards) {
    completed += c.completedCount;
    redo += c.redoCount;
    reopen += c.reopenCount;
    if (c.avgCycleTimeHours != null && c.completedCount > 0) { cycleWeighted += c.avgCycleTimeHours * c.completedCount; cycleWeight += c.completedCount; }
    if (c.boardHygieneScore != null) hygienes.push(c.boardHygieneScore);
  }

  return {
    completed,
    avgCycleTimeHours: cycleWeight > 0 ? cycleWeighted / cycleWeight : null,
    reworkRate: completed > 0 ? (redo + reopen) / completed : null,
    boardHygieneScore: hygienes.length ? hygienes.reduce((a, b) => a + b, 0) / hygienes.length : null,
  };
}

// ── DORA ─────────────────────────────────────────────────────────────────────

export interface DoraRollup {
  windowDays: number;
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;        // task createdAt → completedAt, avg
  changeFailureRatePct: number | null; // failed deploys / total deploys
  mttrHours: number | null;            // avg(restoredAt − deployedAt) over failed+restored
  /** Per-week buckets so the four keys can be charted over time. Mirrors the
   *  adoption-series bucketing (application/insights/aiImpactInsights.ts). */
  series: DoraSeriesPoint[];
}

/** One weekly DORA bucket — the four keys computed over that week's rows. */
export interface DoraSeriesPoint {
  /** UTC YYYY-MM-DD of the bucket start (anchored at the window start). */
  bucketStart: string;
  deploymentFrequencyPerDay: number;
  totalDeployments: number;
  leadTimeHours: number | null;
  changeFailureRatePct: number | null;
  mttrHours: number | null;
}

export interface DeployRow { deployedAt: Date; isFailure: boolean; restoredAt: Date | null; }
/** A completed task's create→complete span, used for per-bucket lead time. */
export interface LeadRow { completedAt: Date; leadTimeHrs: number; }

const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** The four DORA keys over one bucket of `bucketDays` — the shared math both the
 *  window rollup and each weekly series point use (no second definition). */
function doraKeys(bucketDays: number, leadTimesHrs: number[], deploys: DeployRow[]) {
  const total = deploys.length;
  const failures = deploys.filter((d) => d.isFailure).length;
  const mttr = deploys
    .filter((d) => d.isFailure && d.restoredAt != null)
    .map((d) => (d.restoredAt!.getTime() - d.deployedAt.getTime()) / HOUR_MS)
    .filter((h) => h >= 0);
  return {
    deploymentFrequencyPerDay: bucketDays > 0 ? total / bucketDays : 0,
    totalDeployments: total,
    leadTimeHours: avg(leadTimesHrs),
    changeFailureRatePct: total ? (failures / total) * 100 : null,
    mttrHours: avg(mttr),
  };
}

/** UTC YYYY-MM-DD of a timestamp. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Pure: bucket deploys + lead times into per-week DORA points anchored at
 * `windowStart` (one bucket per elapsed week), mirroring summarizeAdoption. A
 * deploy is bucketed by deployedAt, a lead time by its completedAt. The last
 * (current) week is partial; its per-day frequency uses the elapsed days so it
 * isn't diluted by the not-yet-elapsed remainder of the week.
 */
export function rollupDoraSeries(windowStart: number, now: number, leads: LeadRow[], deploys: DeployRow[]): DoraSeriesPoint[] {
  const count = Math.max(1, Math.ceil((now - windowStart) / WEEK_MS));
  const deployBuckets: DeployRow[][] = Array.from({ length: count }, () => []);
  const leadBuckets: number[][] = Array.from({ length: count }, () => []);
  for (const d of deploys) {
    const idx = Math.floor((d.deployedAt.getTime() - windowStart) / WEEK_MS);
    if (idx >= 0 && idx < count) deployBuckets[idx]!.push(d);
  }
  for (const l of leads) {
    const idx = Math.floor((l.completedAt.getTime() - windowStart) / WEEK_MS);
    if (idx >= 0 && idx < count) leadBuckets[idx]!.push(l.leadTimeHrs);
  }
  return deployBuckets.map((bucketDeploys, i) => {
    const bucketStartMs = windowStart + i * WEEK_MS;
    const elapsedMs = Math.min(WEEK_MS, now - bucketStartMs);
    const bucketDays = Math.max(1, elapsedMs / DAY_MS);
    return { bucketStart: isoDay(bucketStartMs), ...doraKeys(bucketDays, leadBuckets[i]!, bucketDeploys) };
  });
}

/** Pure DORA math for the whole window. Separated for unit testing. */
export function rollupDora(days: number, leadTimesHrs: number[], deploys: DeployRow[], series: DoraSeriesPoint[] = []): DoraRollup {
  return { windowDays: days, ...doraKeys(days, leadTimesHrs, deploys), series };
}

export async function computeDora(db: Db, tenantId: number, days: number): Promise<DoraRollup> {
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);

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
      notSystemTask,
    ));
  const leads: LeadRow[] = leadRows
    .map((r) => ({ completedAt: r.completedAt!, leadTimeHrs: (r.completedAt!.getTime() - r.createdAt.getTime()) / HOUR_MS }))
    .filter((l) => l.leadTimeHrs >= 0);
  const leadTimes = leads.map((l) => l.leadTimeHrs);

  const series = rollupDoraSeries(since.getTime(), now, leads, deploys);
  return rollupDora(days, leadTimes, deploys, series);
}
