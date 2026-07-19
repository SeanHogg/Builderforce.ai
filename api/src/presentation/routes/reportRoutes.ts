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
import { and, count, desc, eq, gte, lte, lt, isNull, notExists, inArray, sql } from 'drizzle-orm';
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
  customerFeedback,
  portfolios,
} from '../../infrastructure/database/schema';
import { notSystemTask } from '../../application/task/taskScope';
import { computePortfolioRollup } from '../../application/pmo/portfolioRollup';
import { buildExecutiveSummary } from '../../application/reports/executiveSummary';
import { generateProjectStatusReport } from '../../application/reports/projectStatusReport';
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

  // Aggregate merged-PR count + mean cycle time in SQL — the row set is unbounded
  // and only feeds these two numbers, so we never materialize it. AVG() ignores
  // NULL cycle times and is itself NULL when none exist, exactly matching the prior
  // "mean over rows that have a cycle time, null when there are none".
  const [mergedAgg] = await db
    .select({
      total: count(),
      avgCycleHours: sql<number | null>`AVG(${activityEvents.cycleTimeHours})`,
    })
    .from(activityEvents)
    .where(and(
      eq(activityEvents.tenantId, tenantId),
      eq(activityEvents.eventType, 'pr_merged'),
      gte(activityEvents.occurredAt, from),
      lte(activityEvents.occurredAt, to),
    ));
  const mergedPrsCount = Number(mergedAgg?.total ?? 0);
  const avgCycleTime = mergedAgg?.avgCycleHours != null ? Math.round(Number(mergedAgg.avgCycleHours)) : null;

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
      mergedPrs:       mergedPrsCount,
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

// Executive summary now lives in application/reports/executiveSummary.ts so the
// deck generator can reuse it. Alias keeps the existing call sites unchanged.
const generateExecutiveReport = buildExecutiveSummary;

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

// The standup / code-review / executive GET endpoints are cached the same way as
// completed-by-assignee: keyed on (tenant, version, window) and folding in the
// SAME per-tenant report version token (bumped on any task status write via
// invalidateCompletedByAssignee), with the getOrSetCached KV TTL as the backstop
// for activity/metric writes that don't bump the token.
export function standupCacheKey(tenantId: number, version: number, dayKey: string): string {
  return `report-standup:tenant:${tenantId}:v:${version}:date:${dayKey}`;
}
export function codeReviewCacheKey(tenantId: number, version: number, windowKey: string): string {
  return `report-code-review:tenant:${tenantId}:v:${version}:w:${windowKey}`;
}
export function executiveCacheKey(tenantId: number, version: number, windowKey: string): string {
  return `report-executive:tenant:${tenantId}:v:${version}:w:${windowKey}`;
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
      notSystemTask,
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

/**
 * Portfolio rollup report (PMO exec summary) — one row per portfolio with its
 * delivery / spend / DORA / OKR / dependency-health rollup. Reuses the canonical
 * computePortfolioRollup so the scheduled report and the live /pmo lens never
 * drift. Sequential over portfolios (few per tenant; MANAGER-gated, infrequent).
 */
async function generatePortfolioReport(db: Db, tenantId: number, segmentId: string) {
  const pfRows = await db
    .select({ id: portfolios.id, name: portfolios.name, status: portfolios.status })
    .from(portfolios)
    .where(and(eq(portfolios.tenantId, tenantId), eq(portfolios.segmentId, segmentId)));

  const now = Date.now();
  const items: Array<Record<string, unknown>> = [];
  for (const pf of pfRows) {
    const r = await computePortfolioRollup(db, tenantId, segmentId, { kind: 'portfolio', id: pf.id }, { now });
    if (!r) continue;
    items.push({
      portfolioId: pf.id,
      name: pf.name,
      status: pf.status,
      initiativeCount: r.initiativeCount,
      projectCount: r.projectCount,
      completedTasks: r.delivery.completedCount,
      openTasks: r.delivery.openCount,
      agentLlmCostUsd: r.spend.agentLlmCostUsd,
      okrProgressPct: Math.round(r.okr.avgProgress * 100),
      deploymentsWindow: r.dora.totalDeployments,
      changeFailureRatePct: r.dora.changeFailureRatePct,
      criticalPathLength: r.criticalPath.length,
      blockedInitiatives: r.byInitiative.filter((i) => i.isBlocked).length,
    });
  }

  const totalCost = items.reduce((s, i) => s + (i.agentLlmCostUsd as number), 0);
  const avgOkr = items.length
    ? Math.round(items.reduce((s, i) => s + (i.okrProgressPct as number), 0) / items.length)
    : 0;
  return {
    reportType: 'portfolio_rollup',
    generatedAt: new Date().toISOString(),
    summary: {
      portfolios: items.length,
      totalAgentLlmCostUsd: totalCost,
      avgOkrProgressPct: avgOkr,
    },
    portfolios: items,
  };
}

/**
 * Dispatch a schedulable report_type → its generator, returning an email-ready
 * { subject, report }. Reuses the on-demand generators above (single source of
 * generation logic — the scheduled dispatcher and the GET endpoints never drift).
 * Returns null for report types without a generator (e.g. project_status), so the
 * sweep can skip them cleanly.
 */
const REPORT_DAY_MS = 24 * 60 * 60 * 1000;
export async function buildScheduledReport(
  db: Db,
  reportType: string,
  tenantId: number,
  segmentId: string,
  now: Date,
): Promise<{ subject: string; report: Record<string, unknown> } | null> {
  switch (reportType) {
    case 'standup':
      return { subject: '[Builderforce] Daily standup report', report: await generateStandupReport(db, tenantId, now) };
    case 'code_review':
      return { subject: '[Builderforce] Code review report', report: await generateCodeReviewReport(db, tenantId, new Date(now.getTime() - 14 * REPORT_DAY_MS), now) };
    case 'executive_summary':
      return { subject: '[Builderforce] Executive summary', report: await generateExecutiveReport(db, tenantId, new Date(now.getTime() - 30 * REPORT_DAY_MS), now) as unknown as Record<string, unknown> };
    case 'portfolio_rollup':
      return { subject: '[Builderforce] Portfolio (PMO) rollup', report: await generatePortfolioReport(db, tenantId, segmentId) };
    case 'project_status':
      return { subject: '[Builderforce] Project status digest', report: await generateProjectStatusReport(db, tenantId, segmentId) as unknown as Record<string, unknown> };
    default:
      return null;
  }
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
    const dateParam = c.req.query('date');
    const date = dateParam ? new Date(dateParam) : new Date();
    const env = c.env as Env;
    const version = await readCompletedByAssigneeVersion(env, tenantId);
    const report = await getOrSetCached(
      env,
      standupCacheKey(tenantId, version, dateParam ?? date.toISOString().slice(0, 10)),
      () => generateStandupReport(db, tenantId, date),
    );
    return c.json(report);
  });

  // ── GET /api/reports/code-review ─────────────────────────────────────────
  router.get('/code-review', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const to   = new Date();
    const from = new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);
    const env = c.env as Env;
    const version = await readCompletedByAssigneeVersion(env, tenantId);
    const report = await getOrSetCached(
      env,
      codeReviewCacheKey(tenantId, version, to.toISOString().slice(0, 10)),
      () => generateCodeReviewReport(db, tenantId, from, to),
    );
    return c.json(report);
  });

  // ── GET /api/reports/executive ────────────────────────────────────────────
  router.get('/executive', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const toParam   = c.req.query('to');
    const fromParam = c.req.query('from');
    const to   = toParam   ? new Date(toParam)   : new Date();
    const from = fromParam ? new Date(fromParam) : new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
    const env = c.env as Env;
    const version = await readCompletedByAssigneeVersion(env, tenantId);
    const windowKey = `${fromParam ?? from.toISOString().slice(0, 10)}:${toParam ?? to.toISOString().slice(0, 10)}`;
    const report = await getOrSetCached(
      env,
      executiveCacheKey(tenantId, version, windowKey),
      () => generateExecutiveReport(db, tenantId, from, to),
    );
    return c.json(report);
  });

  // ── GET /api/reports/portfolio ────────────────────────────────────────────
  // PMO portfolio rollup exec summary (schedulable as report_type 'portfolio_rollup').
  router.get('/portfolio', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string;
    return c.json(await generatePortfolioReport(db, tenantId, segmentId));
  });

  // ── GET /api/reports/project-status ───────────────────────────────────────
  // Per-project delivery digest (schedulable as report_type 'project_status').
  router.get('/project-status', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string;
    return c.json(await generateProjectStatusReport(db, tenantId, segmentId));
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

  // ── Voice-of-Customer inbox (ingested customer_feedback triage) ───────────
  // GET  /api/reports/feedback        list the segment's feedback (?status=new|triaged|dismissed)
  // PATCH /api/reports/feedback/:id   triage: flip status, optionally link a backlog task
  const FEEDBACK_STATUSES = new Set(['new', 'triaged', 'dismissed']);

  router.get('/feedback', async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string;
    const statusFilter = c.req.query('status');
    const conds = [eq(customerFeedback.tenantId, tenantId), eq(customerFeedback.segmentId, segmentId)];
    if (statusFilter && FEEDBACK_STATUSES.has(statusFilter)) {
      conds.push(eq(customerFeedback.status, statusFilter));
    }
    const rows = await db
      .select({
        id: customerFeedback.id,
        externalRef: customerFeedback.externalRef,
        widgetId: customerFeedback.widgetId,
        text: customerFeedback.text,
        sentiment: customerFeedback.sentiment,
        contact: customerFeedback.contact,
        status: customerFeedback.status,
        triagedTaskId: customerFeedback.triagedTaskId,
        triagedAt: customerFeedback.triagedAt,
        createdAt: customerFeedback.createdAt,
      })
      .from(customerFeedback)
      .where(and(...conds))
      .orderBy(desc(customerFeedback.createdAt))
      .limit(200);
    return c.json({ feedback: rows });
  });

  router.patch('/feedback/:id', requireRole(TenantRole.MANAGER), async (c) => {
    const tenantId = c.get('tenantId') as number;
    const segmentId = c.get('segmentId') as string;
    const id = c.req.param('id');
    const body = await c.req.json<{ status?: string; taskId?: number }>().catch(() => ({}) as { status?: string; taskId?: number });
    const status = body.status;
    if (!status || !FEEDBACK_STATUSES.has(status)) {
      return c.json({ error: `status must be one of: ${[...FEEDBACK_STATUSES].join(', ')}` }, 400);
    }

    // When triaging into the backlog, optionally link the task it became. The
    // link is validated to the same segment so a triage can't point at another
    // end-client's task. (Spawning the task itself is a task-domain concern; the
    // caller passes the created/linked taskId here.)
    let triagedTaskId: number | null = null;
    if (status === 'triaged' && typeof body.taskId === 'number') {
      const [task] = await db
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.id, body.taskId), eq(tasks.segmentId, segmentId)))
        .limit(1);
      if (!task) return c.json({ error: 'taskId not found in this segment' }, 400);
      triagedTaskId = task.id;
    }

    const patch: Record<string, unknown> = { status };
    if (status === 'triaged') {
      patch.triagedAt = new Date();
      patch.triagedTaskId = triagedTaskId;
    } else {
      // Re-opening or dismissing clears any triage linkage.
      patch.triagedAt = null;
      patch.triagedTaskId = null;
    }

    const [updated] = await db
      .update(customerFeedback)
      .set(patch)
      .where(and(
        eq(customerFeedback.id, id),
        eq(customerFeedback.tenantId, tenantId),
        eq(customerFeedback.segmentId, segmentId),
      ))
      .returning({ id: customerFeedback.id, status: customerFeedback.status, triagedTaskId: customerFeedback.triagedTaskId });
    if (!updated) return c.json({ error: 'feedback not found' }, 404);
    return c.json(updated);
  });

  return router;
}
