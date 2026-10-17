/**
 * Dev-activity report generators — standup, code review, team comparison and
 * inactive contributors. Read-only over `activity_events` / `contributor_daily_metrics`;
 * the on-demand GETs (`/api/reports/*`) and the scheduled dispatcher
 * (`scheduledReport.ts`) share these, so the two never drift.
 */

import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import {
  activityEvents,
  contributors,
  contributorDailyMetrics,
  devTeams,
  devTeamMembers,
} from '../../infrastructure/database/schema';

export async function generateStandupReport(db: Db, tenantId: number, date: Date) {
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

export async function generateCodeReviewReport(db: Db, tenantId: number, from: Date, to: Date) {
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

export async function generateTeamComparisonReport(db: Db, tenantId: number, from: Date, to: Date) {
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

export async function generateInactiveContributorsReport(db: Db, tenantId: number, inactiveDays: number) {
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
