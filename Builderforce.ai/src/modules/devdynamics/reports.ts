// DevDynamics - Report Generation (Standup + Executive Summary)
// Implements FR-4 daily standup and FR-4.5 executive summary reports.
// Outputs human narrative and structured data; LLM integration via prompts.

import type { UnifiedContributor, ActivityEvent, DeliveredReport, ReportData } from './types';

/** Report generator config */
export interface ReportGeneratorConfig {
  dailyStandupPrompt: string;
  executiveSummaryPrompt: string;
}

/** Standup report generation (daily, per-team) — FR-4 */
export interface StandupReportContext {
  orgId: string;
  contributors: UnifiedContributor[];
  teams: string[];
  periodStart: string; // UTC ISO
  periodEnd: string;
}

export async function generateDailyStandupReport(cfg: ReportGeneratorConfig, ctx: StandupReportContext): Promise<DeliveredReport> {
  const now = new Date();
  const deadline = new Date();

  // Aggregate 24h activity by contributor
  const byContributor = new Map<string, ActivityEvent[]>();
  const events = await devDynamicsRepository.getActivities(
    ctx.orgId,
    { startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), endTime: new Date().toISOString() }
  );
  for (const ev of events) {
    if (!byContributor.has(ev.contributorId)) byContributor.set(ev.contributorId, []);
    byContributor.get(ev.contributorId)!.push(ev);
  }

  // Per contributor summary (last 24h)
  const contributorsData: ReportData['contributors'] = [];
  for (const c of ctx.contributors) {
    const evs = byContributor.get(c.id) || [];
    contributorsData.push({
      contributorId: c.id,
      displayName: c.displayName,
      commitsLast24h: evs.filter(e => e.eventType === 'commit_push').length,
      prsOpenedLast24h: evs.filter(e => e.eventType === 'pr_opened').length,
      prsReviewedLast24h: evs.filter(e => e.eventType === 'pr_reviewed').length,
      prsMergedLast24h: evs.filter(e => e.eventType === 'pr_merged').length,
      issuesTransitionedLast24h: evs.filter(e => e.eventType === 'jira_issue_updated').length,
      issuesCommentedOnLast24h: evs.filter(e => e.eventType === 'jira_comment_added').length,
      blockersDetected: evs.filter(e => e.eventType === 'blocker_detected').length,
      activityUrl: `/activity?orgId=${ctx.orgId}`,
      profileUrl: `/contributors/${c.id}`,
    });
  }

  // Narrative (LLM placeholder; can be replaced with real LLM)
  const narrative = generateDraftStandupNarrative(contributorsData, ctx.teams);

  const report: DeliveredReport = {
    id: crypto.randomUUID(),
    reportConfigId: crypto.randomUUID(),
    reportType: 'daily_standup',
    generatedAt: now.toISOString(),
    deadline,
    recipientScope: { type: 'org', scopeId: ctx.orgId },
    scopeData: { orgId: ctx.orgId, contributors: ctx.contributors, teams: [] },
    summary: { narrative, data: { contributors: contributorsData, teams: [], general: createDraftGeneralMetrics() } },
    format: 'markdown',
  };

  return report;
}

/** Executive summary (weekly, per-org) — FR-4.5 */
export async function generateExecutiveSummaryReport(cfg: ReportGeneratorConfig, orgId: string): Promise<DeliveredReport> {
  const now = new Date();
  const days = 7;
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  // Aggregate events for the org over the week
  const events = await devDynamicsRepository.getActivities(
    orgId,
    { startTime: start, endTime: now.toISOString() }
  );

  const contributors = await devDynamicsRepository.getAllContributors();
  const uniqueContributors = new Set(contributors.map(c => c.id));
  const totalCommits = events.filter(e => e.eventType === 'commit_push').length;
  const uniqueContributorsCommits = events.filter(e => e.eventType === 'commit_push' && uniqueContributors.has(e.contributorId)).length;

  const narrative = generateDraftExecutiveSummary(totalCommits, uniqueContributorsCommits, events.length);

  const report: DeliveredReport = {
    id: crypto.randomUUID(),
    reportConfigId: crypto.randomUUID(),
    reportType: 'weekly_executive',
    generatedAt: now.toISOString(),
    recipientScope: { type: 'org', scopeId: orgId },
    scopeData: { orgId, contributors: contributors.slice(0, 20), teams: [] },
    summary: { narrative, data: { contributors: [], teams: [], general: { totalCommits, totalPRsMerged: 0, totalIssuesCompleted: 0, averageCycleTime: 2, blockerCount: 0, openBlockersSummary: 'none' } } },
    format: 'markdown',
  };

  return report;
}

/** Helper metrics snapshot (draft; replace with real aggregation) */
function createDraftGeneralMetrics(): ReportData['general'] {
  return { totalCommits: 0, totalPRsMerged: 0, totalIssuesCompleted: 0, averageCycleTime: 0, blockerCount: 0, openBlockersSummary: '' };
}

/** Minimal narrative generation (LLM placeholder) */
function generateDraftStandupNarrative(contributors: ReportData['contributors'], teams: string[]): string {
  const topContributors = [...contributors].sort((a, b) => b.prMergedLast24h + b.commitsLast24h - (a.prMergedLast24h + a.commitsLast24h) || 0).slice(0, 5);
  const lines = [
    '# Daily Standup',
    `**Generated at:** ${new Date().toISOString()}`,
    '',
    '## Top Contributors This Sprint',
    topContributors.map(c => `- ${c.displayName}: ${c.commitsLast24h} commits, ${c.prMergedLast24h} PRs merged, ${c.blockersDetected} blockers`).join('\n'),
    '',
    '## Activity Breakdown',
    `Total: ${contributors.reduce((s, c) => s + c.commitsLast24h + c.prMergedLast24h + c.reviewedLast24h, 0)} events`),
    '',
    '## Notes',
    ' (Use LLM assistant to turn this into natural-language narrative per team and highlight blockers; see PRD FR-4.4).',
  ];
  return lines.join('\n');
}

function generateDraftExecutiveSummary(totalCommits: number, uniqueContributors: number, totalEvents: number): string {
  return `## Weekly Executive Summary (Generated: ${new Date().toISOString()})
**Commits:** ${totalCommits} (by ${uniqueContributors} contributors)
**Total Events:** ${totalEvents}
**Notes:** Detailed narrative, cycle times, and blockers depend on LLM report generation integration (FR-4.8, see prd).`;
}

/** Public API stub routes (to be wired into Express in orchestrator.ts) */
export const reportRoutes = {
  listReports: async (orgId: string, reportType?: string) => {
    const all = await devDynamicsRepository.delivered_reports;
    // TODO: implement findDeliveredReports(configId) in repository
    return [];
  },
  getReport: async (eventId: string) => {
    // TODO: implement findDeliveredReport(id) in repository
    return null;
  },
  reconcile: async (report: DeliveredReport) => {
    await devDynamicsRepository.delivered_reports.set(report.id, report);
  },
};

// TODO: Integrate real LLM assistant once assistant enabled. Use FR-4.3 in-app delivery once reports are persisted.