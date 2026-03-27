/**
 * Dev analytics report routes – /api/reports
 *
 * On-demand and scheduled report generation.
 *
 * GET  /api/reports/standup          Daily standup report (MANAGER+)
 * GET  /api/reports/code-review      Code review report (MANAGER+)
 * GET  /api/reports/executive        Executive summary report (MANAGER+)
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
import { and, desc, eq, gte, lte, lt, isNull, notExists } from 'drizzle-orm';
import { authMiddleware, requireRole } from '../middleware/authMiddleware';
import {
  activityEvents,
  contributors,
  contributorDailyMetrics,
  devTeams,
  devTeamMembers,
  reportSchedules,
  reportSubscriptions,
} from '../../infrastructure/database/schema';
import { TenantRole } from '../../domain/shared/types';
import type { HonoEnv } from '../../env';
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
