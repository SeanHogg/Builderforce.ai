/**
 * Executive-summary assembly — extracted from reportRoutes so BOTH the report
 * endpoint AND the deck generator (DeckService) build the same KPI bundle from
 * one place (DRY). Pure I/O over contributor_daily_metrics + contributors; no
 * caching here (callers cache).
 */

import { and, eq, gte, lte } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { contributorDailyMetrics, contributors } from '../../infrastructure/database/schema';

export interface ExecutiveSummary {
  reportType: 'executive_summary';
  from: string;
  to: string;
  generatedAt: string;
  kpis: {
    totalContributors: number;
    activeDays: number;
    totalCommits: number;
    totalPrsMerged: number;
    totalIssuesResolved: number;
    totalLinesAdded: number;
    avgActivityScore: number;
  };
  topContributors: Array<{ id: number; displayName: string | null; score: number }>;
  observations: string[];
}

/** Build the executive KPI bundle for a tenant over [from, to]. */
export async function buildExecutiveSummary(db: Db, tenantId: number, from: Date, to: Date): Promise<ExecutiveSummary> {
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

  const byContributor = new Map<number, number>();
  for (const m of metrics) {
    byContributor.set(m.contributorId, (byContributor.get(m.contributorId) ?? 0) + m.activityScore);
  }
  const topIds = Array.from(byContributor.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => id);

  const topRows = topIds.length > 0 ? await db
    .select({ id: contributors.id, displayName: contributors.displayName })
    .from(contributors)
    .where(eq(contributors.tenantId, tenantId)) : [];

  return {
    reportType: 'executive_summary',
    from: from.toISOString(),
    to: to.toISOString(),
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
    topContributors: topRows
      .filter((c) => topIds.includes(c.id))
      .map((c) => ({ ...c, score: byContributor.get(c.id) ?? 0 })),
    observations: [
      totalPrsMerged > 0 ? `${totalPrsMerged} PRs merged in the period.` : null,
      totalCommits > 0 ? `${totalCommits} commits across ${totalContributors} contributor(s).` : null,
      avgScore > 0 ? `Average activity score: ${avgScore}.` : null,
    ].filter((o): o is string => o !== null),
  };
}
