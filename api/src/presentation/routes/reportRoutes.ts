/**
 * Dev analytics report routes – /api/reports
 *
 * On-demand and scheduled report generation.
 *
 * GET  /api/reports/standup          Daily standup report (MANAGER+)
 * GET  /api/reports/code-review      Code review report (MANAGER+)
 * GET  /api/reports/executive        Executive summary report (MANAGER+)
 * GET  /api/reports/completed-by-assignee  Tasks completed per assignee over a window (MANAGER+)
 *
 * GET  /api/reports/schedules        List report schedules (MANAGER+)
 * POST /api/reports/schedules        Create schedule (MANAGER+)
 * PATCH /api/reports/schedules/:id   Update schedule (MANAGER+)
 * DELETE /api/reports/schedules/:id  Delete schedule (MANAGER+)
 *
 * GET  /api/reports/subscriptions    Get my subscriptions (any user)
 * POST /api/reports/subscriptions    Update my subscriptions (any user)
 */

import { Hono } from 'hono';
import { and, desc, eq, gte, lte, lt, isNull, notExists, inArray, sql } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  activityEvents,
  contributors,
  contributorDailyMetrics,
  devTeams,
  devTeamMembers,
  reportSchedules,
  reportSubscriptions,
  tasks,
  projects,
  users,
  agentHosts,
} from '../../infrastructure/database/schema';
import { TenantRole, TaskStatus } from '../../domain/shared/types';
import { getOrSetCached, invalidateCached } from '../../infrastructure/cache/readThroughCache';
import type { Env, HonoEnv } from '../../env';
import type { Db } from '../../infrastructure/database/connection';

// ---------------------------------------------------------------------------
// Report generation helpers
// ---------------------------------------------------------------------------

async function generateStandupReport(db: Db, tenantId: number, date: Date) {
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);

  // Activity yesterday vs today
  const [todayMetrics, yesterdayMetrics] = await Promise.all([
    db.select().from(contributorDailyMetrics)
      .where(and(eq(contributorDailyMetrics.tenantId, tenantId), eq(contributorDailyMetrics.date, dayStart))),
    db.select().from(contributorDailyMetrics)
      .where(and(
        eq(contributorDailyMetrics.tenantId, tenantId),
        eq(contributorDailyMetrics.date, new Date(dayStart.getTime() - 86400_000)),
      )),
  ]);

  // PRs opened/merged today
  const prsToday = await db.select()
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      gte(activityEvents.occurredAt, dayStart),
      lte(activityEvents.occurredAt, dayEnd),
      eq(activityEvents.eventType, 'pr_opened'),
    ))
    .limit(20);

  // Issues resolved today
  const resolvedToday = await db.select()
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      gte(activityEvents.occurredAt, dayStart),
      lte(activityEvents.occurredAt, dayEnd),
      eq(activityEvents.eventType, 'issue_resolved'),
    ))
    .limit(20);

  const activeContributors = todayMetrics.filter((m) => m.isActiveDay).length;
  const totalCommits = todayMetrics.reduce((s, m) => s + m.commits, 0);
  const totalPrsMerged = todayMetrics.reduce((s, m) => s + m.prsMerged, 0);
  const totalIssues = todayMetrics.reduce((s, m) => s + m.issuesCreated, 0);

  return {
    reportType:     'standup',
    date:           dayStart.toISOString(),
    generatedAt:    new Date().toISOString(),
    summary: {
      activeContributors,
      totalCommits,
      totalPrsMerged,
      totalIssuesCreated: totalIssues,
      prsOpenedToday: prsToday.length,
      issuesResolvedToday: resolvedToday.length,
    },
    recentPrs:        prsToday.slice(0, 5).map((e) => ({ title: e.title, url: e.url, repo: e.repositoryName })),
    resolvedIssues:   resolvedToday.slice(0, 5).map((e) => ({ title: e.title, url: e.url })),
    insights: [
      activeContributors === 0 ? 'No contributor activity recorded today.' :
      `${activeContributors} contributor(s) active today with ${totalCommits} commit(s).`,
      totalPrsMerged > 0 ? `${totalPrsMerged} PR(s) merged today.` : 'No PRs merged today.',
    ].filter(Boolean),
  };
}

async function generateCodeReviewReport(db: Db, tenantId: number, from: Date, to: Date) {
  const reviews = await db.select()
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      eq(activityEvents.eventType, 'pr_reviewed'),
      gte(activityEvents.occurredAt, from),
      lte(activityEvents.occurredAt, to),
    ))
    .orderBy(desc(activityEvents.occurredAt))
    .limit(100);

  const openPrs = await db.select()
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      eq(activityEvents.eventType, 'pr_opened'),
      gte(activityEvents.occurredAt, from),
    ))
    .limit(50);

  const mergedPrs = await db.select()
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      eq(activityEvents.eventType, 'pr_merged'),
      gte(activityEvents.occurredAt, from),
      lte(activityEvents.occurredAt, to),
    ));

  // Average cycle time
  const cycleTimePrs = mergedPrs.filter((p) => p.cycleTimeHours != null);
  const avgCycleTime = cycleTimePrs.length > 0
    ? Math.round(cycleTimePrs.reduce((s, p) => s + (p.cycleTimeHours ?? 0), 0) / cycleTimePrs.length)
    : null;

  // Stale PRs (opened >7 days ago, not yet merged)
  const staleThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const stalePrs = openPrs.filter((p) => p.occurredAt < staleThreshold);

  return {
    reportType:  'code_review',
    from:        from.toISOString(),
    to:          to.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: {
      totalReviews:    reviews.length,
      openPrs:         openPrs.length,
      mergedPrs:       mergedPrs.length,
      stalePrs:        stalePrs.length,
      avgCycleTimeHrs: avgCycleTime,
    },
    stalePrList: stalePrs.slice(0, 10).map((p) => ({
      title:     p.title,
      url:       p.url,
      repo:      p.repositoryName,
      openedAt:  p.occurredAt,
      ageHours:  Math.round((Date.now() - p.occurredAt.getTime()) / 3_600_000),
    })),
    recentReviews: reviews.slice(0, 10).map((r) => ({
      title:     r.title,
      url:       r.url,
      repo:      r.repositoryName,
      reviewedAt: r.occurredAt,
    })),
  };
}

async function generateExecutiveReport(db: Db, tenantId: number, from: Date, to: Date) {
  const metrics = await db.select()
    .from(contributorDailyMetrics)
    .where(and(
      eq(contributorDailyMetrics.tenantId, tenantId),
      gte(contributorDailyMetrics.date, from),
      lte(contributorDailyMetrics.date, to),
    ));

  const totalContributors = new Set(metrics.map((m) => m.contributorId)).size;
  const activeDays = metrics.filter((m) => m.isActiveDay).length;
  const totalCommits = metrics.reduce((s, m) => s + m.commits, 0);
  const totalPrsMerged = metrics.reduce((s, m) => s + m.prsMerged, 0);
  const totalIssues = metrics.reduce((s, m) => s + m.issuesResolved, 0);
  const totalLinesAdded = metrics.reduce((s, m) => s + m.linesAdded, 0);
  const avgScore = metrics.length > 0
    ? Math.round(metrics.reduce((s, m) => s + m.activityScore, 0) / metrics.length)
    : 0;

  // Top contributors by activity score
  const byContributor = new Map<number, number>();
  for (const m of metrics) {
    byContributor.set(m.contributorId, (byContributor.get(m.contributorId) ?? 0) + m.activityScore);
  }
  const topIds = Array.from(byContributor.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const topContributors = topIds.length > 0 ? await db
    .select({ id: contributors.id, displayName: contributors.displayName })
    .from(contributors)
    .where(and(
      eq(contributors.tenantId, tenantId),
    )) : [];

  return {
    reportType:  'executive_summary',
    from:        from.toISOString(),
    to:          to.toISOString(),
    generatedAt: new Date().toISOString(),
    kpis: {
      totalContributors,
      activeDays,
      totalCommits,
      totalPrsMerged,
      totalIssuesResolved: totalIssues,
      totalLinesAdded,
      avgActivityScore: avgScore,
    },
    topContributors: topContributors
      .filter((c) => topIds.includes(c.id))
      .map((c) => ({ ...c, score: byContributor.get(c.id) ?? 0 })),
    observations: [
      totalPrsMerged > 0 ? `${totalPrsMerged} PRs merged in the period.` : null,
      totalCommits > 0 ? `${totalCommits} commits across ${totalContributors} contributor(s).` : null,
      avgScore > 0 ? `Average activity score: ${avgScore}.` : null,
    ].filter(Boolean),
  };
}

async function generateTeamComparisonReport(db: Db, tenantId: number, from: Date, to: Date) {
  // Load all teams for the tenant
  const teams = await db.select().from(devTeams).where(eq(devTeams.tenantId, tenantId));

  // Load all team memberships
  const memberships = await db.select({
    teamId:        devTeamMembers.teamId,
    contributorId: devTeamMembers.contributorId,
  }).from(devTeamMembers)
    .innerJoin(devTeams, and(eq(devTeamMembers.teamId, devTeams.id), eq(devTeams.tenantId, tenantId)));

  // Load metrics for the period
  const metrics = await db.select().from(contributorDailyMetrics)
    .where(and(
      eq(contributorDailyMetrics.tenantId, tenantId),
      gte(contributorDailyMetrics.date, from),
      lte(contributorDailyMetrics.date, to),
    ));

  // Aggregate per contributor
  const byContributor = new Map<number, { commits: number; prsMerged: number; prsReviewed: number; issuesResolved: number; activityScore: number; activeDays: number }>();
  for (const m of metrics) {
    const prev = byContributor.get(m.contributorId) ?? { commits: 0, prsMerged: 0, prsReviewed: 0, issuesResolved: 0, activityScore: 0, activeDays: 0 };
    byContributor.set(m.contributorId, {
      commits:        prev.commits        + m.commits,
      prsMerged:      prev.prsMerged      + m.prsMerged,
      prsReviewed:    prev.prsReviewed    + m.prsReviewed,
      issuesResolved: prev.issuesResolved + m.issuesResolved,
      activityScore:  prev.activityScore  + m.activityScore,
      activeDays:     prev.activeDays     + (m.isActiveDay ? 1 : 0),
    });
  }

  // Aggregate per team
  const membersByTeam = new Map<number, number[]>();
  for (const m of memberships) {
    const list = membersByTeam.get(m.teamId) ?? [];
    list.push(m.contributorId);
    membersByTeam.set(m.teamId, list);
  }

  const teamRows = teams.map((team) => {
    const memberIds = membersByTeam.get(team.id) ?? [];
    const memberCount = memberIds.length;
    let totalScore = 0, totalCommits = 0, totalPrs = 0, totalReviews = 0, totalIssues = 0, totalActiveDays = 0;
    for (const cid of memberIds) {
      const c = byContributor.get(cid);
      if (!c) continue;
      totalScore       += c.activityScore;
      totalCommits     += c.commits;
      totalPrs         += c.prsMerged;
      totalReviews     += c.prsReviewed;
      totalIssues      += c.issuesResolved;
      totalActiveDays  += c.activeDays;
    }
    const avgScore = memberCount > 0 ? Math.round(totalScore / memberCount) : 0;
    return {
      teamId:      team.id,
      teamName:    team.name,
      parentTeamId: team.parentTeamId,
      memberCount,
      totalActivityScore: totalScore,
      avgActivityScore:   avgScore,
      totalCommits,
      totalPrsMerged:     totalPrs,
      totalPrsReviewed:   totalReviews,
      totalIssuesResolved: totalIssues,
      totalActiveDays,
    };
  });

  // Sort by avgActivityScore desc
  teamRows.sort((a, b) => b.avgActivityScore - a.avgActivityScore);

  return {
    reportType:  'team_comparison',
    from:        from.toISOString(),
    to:          to.toISOString(),
    generatedAt: new Date().toISOString(),
    teams:       teamRows,
  };
}

async function generateInactiveContributorsReport(db: Db, tenantId: number, inactiveDays: number) {
  const threshold = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
  threshold.setUTCHours(0, 0, 0, 0);

  // All active contributors for tenant (not excluded from metrics)
  const allContributors = await db.select({
    id:          contributors.id,
    displayName: contributors.displayName,
    email:       contributors.email,
    jobTitle:    contributors.jobTitle,
    roleType:    contributors.roleType,
    avatarUrl:   contributors.avatarUrl,
  }).from(contributors)
    .where(and(
      eq(contributors.tenantId, tenantId),
      eq(contributors.isActive, true),
      eq(contributors.excludeFromMetrics, false),
    ));

  // Most recent active day per contributor
  const recentMetrics = await db.select({
    contributorId: contributorDailyMetrics.contributorId,
    lastActiveDate: contributorDailyMetrics.date,
  }).from(contributorDailyMetrics)
    .where(and(
      eq(contributorDailyMetrics.tenantId, tenantId),
      eq(contributorDailyMetrics.isActiveDay, true),
    ))
    .orderBy(desc(contributorDailyMetrics.date));

  // Keep only the latest record per contributor
  const lastActiveByContributor = new Map<number, Date>();
  for (const r of recentMetrics) {
    if (!lastActiveByContributor.has(r.contributorId)) {
      lastActiveByContributor.set(r.contributorId, r.lastActiveDate as unknown as Date);
    }
  }

  const inactive = allContributors
    .map((c) => {
      const lastActive = lastActiveByContributor.get(c.id) ?? null;
      const daysSinceActive = lastActive
        ? Math.floor((Date.now() - lastActive.getTime()) / 86_400_000)
        : null;
      return { ...c, lastActiveDate: lastActive?.toISOString() ?? null, daysSinceActive };
    })
    .filter((c) => c.lastActiveDate === null || new Date(c.lastActiveDate) < threshold)
    .sort((a, b) => (b.daysSinceActive ?? Infinity) - (a.daysSinceActive ?? Infinity));

  return {
    reportType:   'inactive_contributors',
    generatedAt:  new Date().toISOString(),
    inactiveDays,
    threshold:    threshold.toISOString(),
    totalInactive: inactive.length,
    contributors:  inactive,
  };
}

// ---------------------------------------------------------------------------
// Completed-by-assignee rollup (gap [1253])
// ---------------------------------------------------------------------------

/**
 * Lane keys that count a task as "completed". A board lane is free-form text
 * (tasks.status is a varchar), but `done` is the canonical terminal lane the
 * domain transitions to (Task.markDone → TaskStatus.DONE). Kept as a set so a
 * tenant that adds e.g. a `released` lane can be folded in later without
 * touching the grouping logic.
 */
export const DONE_CLASS_STATUSES: readonly string[] = [TaskStatus.DONE];

/** Window (days) clamp — guards against unbounded scans / silly query params. */
const COMPLETED_WINDOW_MIN_DAYS = 1;
const COMPLETED_WINDOW_MAX_DAYS = 365;

/**
 * The window keyspace is unbounded (any `days` in [1,365]), so per the cache
 * convention we fold a per-tenant *version token* into the key instead of trying
 * to delete every window on write. A task status write bumps the token (see
 * {@link invalidateCompletedByAssignee}); every window-keyed entry then ages out
 * naturally on the next read. The token itself is a cheap, separately-cached
 * counter.
 */
function versionTokenKey(tenantId: number): string {
  return `report-completed-by-assignee:ver:tenant:${tenantId}`;
}

/** Cache key for the completed-by-assignee rollup (per tenant + version + window). */
export function completedByAssigneeCacheKey(tenantId: number, version: number, days: number): string {
  return `report-completed-by-assignee:tenant:${tenantId}:v:${version}:days:${days}`;
}

/** Current version token for a tenant's completed-by-assignee cache (defaults to 0). */
async function readCompletedByAssigneeVersion(env: Env, tenantId: number): Promise<number> {
  return getOrSetCached(env, versionTokenKey(tenantId), async () => 0, { kvTtlSeconds: 86_400 });
}

/**
 * Bump the per-tenant version token so every window-keyed rollup entry ages out.
 * Call from the task status-write path. Cheap: one KV write of a small integer.
 */
export async function invalidateCompletedByAssignee(env: Env, tenantId: number): Promise<void> {
  const key = versionTokenKey(tenantId);
  const current = await readCompletedByAssigneeVersion(env, tenantId);
  await invalidateCached(env, key);
  // Re-seed the token at current+1 so the next read computes a fresh window key.
  await getOrSetCached(env, key, async () => current + 1, { kvTtlSeconds: 86_400 });
}

/** One task row as it feeds the grouping (the columns the rollup needs). */
export interface CompletedTaskRow {
  taskId:              number;
  status:              string;
  completedAt:         Date;
  assignedUserId:      string | null;
  assignedUserName:    string | null;
  assignedAgentHostId: number | null;
  assignedHostName:    string | null;
  assignedAgentRef:    string | null;
}

export interface AssigneeRollup {
  assigneeKind: 'human' | 'agent_host' | 'cloud_agent' | 'unassigned';
  assigneeId:   string;
  assigneeName: string;
  completed:    number;
  lastCompletedAt: string;
}

/**
 * Pure grouping: collapse completed task rows into one bucket per assignee
 * (a human OR an agent — host or cloud — are first-class peers on the board, so
 * each is its own row). Exported for unit testing without a DB.
 *
 * Assignee identity precedence mirrors the data model's "exactly one owner"
 * invariant: human > agent host > cloud agent. A row with none falls into a
 * single `unassigned` bucket.
 */
export function groupCompletedByAssignee(rows: CompletedTaskRow[]): AssigneeRollup[] {
  const byKey = new Map<string, AssigneeRollup>();

  for (const row of rows) {
    let kind: AssigneeRollup['assigneeKind'];
    let id: string;
    let name: string;

    if (row.assignedUserId) {
      kind = 'human';
      id = `user:${row.assignedUserId}`;
      name = row.assignedUserName || row.assignedUserId;
    } else if (row.assignedAgentHostId != null) {
      kind = 'agent_host';
      id = `host:${row.assignedAgentHostId}`;
      name = row.assignedHostName || `Agent host #${row.assignedAgentHostId}`;
    } else if (row.assignedAgentRef) {
      kind = 'cloud_agent';
      id = `agent:${row.assignedAgentRef}`;
      name = row.assignedAgentRef;
    } else {
      kind = 'unassigned';
      id = 'unassigned';
      name = 'Unassigned';
    }

    const prev = byKey.get(id);
    if (prev) {
      prev.completed += 1;
      if (row.completedAt.getTime() > new Date(prev.lastCompletedAt).getTime()) {
        prev.lastCompletedAt = row.completedAt.toISOString();
      }
    } else {
      byKey.set(id, {
        assigneeKind: kind,
        assigneeId:   id,
        assigneeName: name,
        completed:    1,
        lastCompletedAt: row.completedAt.toISOString(),
      });
    }
  }

  // Busiest assignee first; stable name tiebreak.
  return Array.from(byKey.values()).sort(
    (a, b) => b.completed - a.completed || a.assigneeName.localeCompare(b.assigneeName),
  );
}

/**
 * Tasks that moved into a done-class lane within the last `days`, grouped by
 * assignee (human or agent). Completion time is the dedicated `tasks.completed_at`
 * (set on the first done-class transition by recordStatusTransition, migration
 * 0117), so later edits to a finished ticket no longer shift the window. Legacy
 * rows predating 0117 have a null `completed_at`, so we COALESCE to `updatedAt`
 * as the backfill proxy. Tenant-scoped by joining projects (tasks carry no tenant_id).
 */
async function generateCompletedByAssigneeReport(db: Db, tenantId: number, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  // Authoritative completion instant with a legacy fallback.
  const completedAtExpr = sql<Date>`COALESCE(${tasks.completedAt}, ${tasks.updatedAt})`;

  const rows = await db
    .select({
      taskId:              tasks.id,
      status:              tasks.status,
      completedAt:         completedAtExpr,
      assignedUserId:      tasks.assignedUserId,
      assignedUserName:    users.displayName,
      assignedAgentHostId: tasks.assignedAgentHostId,
      assignedHostName:    agentHosts.name,
      assignedAgentRef:    tasks.assignedAgentRef,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(users, eq(users.id, tasks.assignedUserId))
    .leftJoin(agentHosts, eq(agentHosts.id, tasks.assignedAgentHostId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      inArray(tasks.status, DONE_CLASS_STATUSES as string[]),
      gte(completedAtExpr, since),
    ));

  const assignees = groupCompletedByAssignee(rows as CompletedTaskRow[]);
  const totalCompleted = rows.length;

  return {
    reportType:   'completed_by_assignee',
    windowDays:   days,
    since:        since.toISOString(),
    generatedAt:  new Date().toISOString(),
    totalCompleted,
    assigneeCount: assignees.length,
    assignees,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function createReportRoutes(db: Db): Hono<HonoEnv> {
  const router = new Hono<HonoEnv>();
  router.use('*', authMiddleware);

  // ── GET /api/reports/standup ──────────────────────────────────────────────
  router.get('/standup', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const date = c.req.query('date') ? new Date(c.req.query('date')!) : new Date();
    return c.json(await generateStandupReport(db, tenantId, date));
  });

  // ── GET /api/reports/code-review ─────────────────────────────────────────
  router.get('/code-review', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const to   = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
    return c.json(await generateCodeReviewReport(db, tenantId, from, to));
  });

  // ── GET /api/reports/executive ────────────────────────────────────────────
  router.get('/executive', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const to   = c.req.query('to')   ? new Date(c.req.query('to')!)   : new Date();
    const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return c.json(await generateExecutiveReport(db, tenantId, from, to));
  });

  // ── GET /api/reports/completed-by-assignee ───────────────────────────────
  // Weekly-oversight rollup: tasks moved into a done-class lane in the last N
  // days, grouped by assignee (human OR agent). Cached read-through keyed on
  // (tenant, window) — invalidated on any task status write via
  // invalidateCompletedByAssignee() in taskRoutes.ts; the KV TTL is the backstop.
  router.get('/completed-by-assignee', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const raw = c.req.query('days') ? parseInt(c.req.query('days')!, 10) : 7;
    const days = Math.min(
      COMPLETED_WINDOW_MAX_DAYS,
      Math.max(COMPLETED_WINDOW_MIN_DAYS, Number.isFinite(raw) ? raw : 7),
    );
    const env = c.env as Env;
    const version = await readCompletedByAssigneeVersion(env, tenantId);
    const report = await getOrSetCached(
      env,
      completedByAssigneeCacheKey(tenantId, version, days),
      () => generateCompletedByAssigneeReport(db, tenantId, days),
    );
    return c.json(report);
  });

  // ── GET /api/reports/team-comparison ─────────────────────────────────────
  router.get('/team-comparison', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const to   = c.req.query('to')   ? new Date(c.req.query('to')!)   : new Date();
    const from = c.req.query('from') ? new Date(c.req.query('from')!) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    return c.json(await generateTeamComparisonReport(db, tenantId, from, to));
  });

  // ── GET /api/reports/inactive-contributors ────────────────────────────────
  router.get('/inactive-contributors', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const days = c.req.query('days') ? Math.max(1, parseInt(c.req.query('days')!, 10)) : 14;
    return c.json(await generateInactiveContributorsReport(db, tenantId, days));
  });

  // ── GET /api/reports/schedules ────────────────────────────────────────────
  router.get('/schedules', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const rows = await db.select().from(reportSchedules)
      .where(eq(reportSchedules.tenantId, tenantId));
    return c.json({ schedules: rows });
  });

  // ── POST /api/reports/schedules ───────────────────────────────────────────
  router.post('/schedules', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const body = await c.req.json<{
      reportType: string;
      schedule: string;
      deliveryHour?: number;
      recipients: string[];
    }>();

    if (!body.reportType || !body.schedule || !Array.isArray(body.recipients)) {
      return c.json({ error: 'reportType, schedule, and recipients[] are required' }, 400);
    }

    const [row] = await db.insert(reportSchedules)
      .values({
        tenantId,
        reportType:   body.reportType as 'standup',
        schedule:     body.schedule as 'daily',
        deliveryHour: body.deliveryHour ?? 8,
        recipients:   JSON.stringify(body.recipients),
      })
      .returning();

    return c.json(row, 201);
  });

  // ── PATCH /api/reports/schedules/:id ─────────────────────────────────────
  router.patch('/schedules/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    const body = await c.req.json<Partial<{
      deliveryHour: number;
      recipients: string[];
      isEnabled: boolean;
    }>>();

    const [updated] = await db.update(reportSchedules)
      .set({
        deliveryHour: body.deliveryHour,
        recipients:   body.recipients ? JSON.stringify(body.recipients) : undefined,
        isEnabled:    body.isEnabled,
        updatedAt:    new Date(),
      })
      .where(and(eq(reportSchedules.id, id), eq(reportSchedules.tenantId, tenantId)))
      .returning();

    if (!updated) return c.json({ error: 'Schedule not found' }, 404);
    return c.json(updated);
  });

  // ── DELETE /api/reports/schedules/:id ────────────────────────────────────
  router.delete('/schedules/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const id = c.req.param('id');

    await db.delete(reportSchedules)
      .where(and(eq(reportSchedules.id, id), eq(reportSchedules.tenantId, tenantId)));
    return c.json({ deleted: true });
  });

  // ── GET /api/reports/subscriptions ───────────────────────────────────────
  router.get('/subscriptions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;

    const rows = await db.select()
      .from(reportSubscriptions)
      .where(and(
        eq(reportSubscriptions.tenantId, tenantId),
        eq(reportSubscriptions.userId, userId),
      ));

    return c.json({ subscriptions: rows });
  });

  // ── POST /api/reports/subscriptions ──────────────────────────────────────
  router.post('/subscriptions', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const userId   = c.get('userId') as string;
    const body = await c.req.json<Array<{ reportType: string; isSubscribed: boolean }>>();

    if (!Array.isArray(body)) return c.json({ error: 'body must be an array of { reportType, isSubscribed }' }, 400);

    for (const item of body) {
      await db.insert(reportSubscriptions)
        .values({
          tenantId,
          userId,
          reportType:   item.reportType as 'standup',
          isSubscribed: item.isSubscribed,
        })
        .onConflictDoUpdate({
          target: [reportSubscriptions.tenantId, reportSubscriptions.userId, reportSubscriptions.reportType],
          set:    { isSubscribed: item.isSubscribed, updatedAt: new Date() },
        });
    }

    return c.json({ updated: body.length });
  });

  return router;
}
