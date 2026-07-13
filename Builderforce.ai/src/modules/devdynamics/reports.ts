// DevDynamics - Report Generation (Standup + Executive Summary)
// Implements FR-4 daily standup and FR-4.5 executive summary reports.
// Outputs human narrative and structured data; PDF/Puppeteer integration stub (PRD FR-4.7).

import type { UnifiedContributor, ActivityEvent, DeliveredReport, ReportData } from './types';
import { devDynamicsRepository } from './repository';

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
  startTime: string; // UTC ISO
  endTime: string;
}

/** Per-step model assignments visibility beyond built-in routing */
export interface PerStepModelAssignmentsMap {
  contributorId: string;
  postedAt: string;
  assignments: Array<{
    step: string;
    source: string;
    modelStage: string;
    timestamp: string;
  }>;
}

/** Schedule-supported report definitions and delivery status (FR-4.1/4.5) */
export interface ScheduledReport {
  id: string;
  orgId: string;
  reportType: 'daily_standup' | 'weekly_executive';
  enabled: boolean;
  timezone: string; // IANA
  cronSchedule: string;
  lastRunAt?: string;
  nextRunAt: string;
  createdBy?: string;
  deliveredReports: DeliverableReport[];
}

export interface DeliverableReport {
  id: string;
  scheduledReportId: string;
  deliveredAt: string;
  format: 'markdown' | 'pdf';
  summary: { narrative: string; data: ReportData };
}

export async function generateDailyStandupReport(
  cfg: ReportGeneratorConfig,
  ctx: StandupReportContext,
  orgId: string,
  assignments: PerStepModelAssignmentsMap | null
): Promise<DeliveredReport> {
  const now = new Date();
  const deadline = new Date(now.getTime() + 30 * 60 * 1000); // Stripe: deliver within window

  // Aggregate events for the window (last visible period; 24h is standard FR-4)
  const events = await devDynamicsRepository.getActivities(
    orgId,
    { startTime: ctx.startTime, endTime: ctx.endTime }
  );
  const byContributor = new Map<string, ActivityEvent[]>();
  for (const ev of events) {
    if (!byContributor.has(ev.contributorId)) byContributor.set(ev.contributorId, []);
    byContributor.get(ev.contributorId)!.push(ev);
  }

  // Per contributor summary (last 24h)
  const contributorsData: ReportData['contributors'] = [];
  const allContributors = ctx.contributors;
  for (const c of allContributors) {
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
      activityUrl: `/activity?orgId=${orgId}`,
      profileUrl: `/contributors/${c.id}`,
    });
  }

  const narrative = generateDraftStandupNarrative(contributorsData, ctx.teams, assignments);

  // General stats snapshot for this org/contributors in window
  const general = {
    totalCommits: byContributor.values().reduce((sum, evs) => sum + evs.filter(e => e.eventType === 'commit_push').length, 0),
    totalPRsMerged: evsByEventType(EVT.commit_push).length + evsByEventType(EVT.pr_merged).length,
    totalIssuesClosed: evsByEventType(EVT.jira_issue_updated).length + evsByEventType(EVT.jira_issue_closed).length,
    averageCycleTime: 0,
    blockerCount: evsByEventType(EVT.blocker_detected).length,
    openBlockersSummary: evsByEventType(EVT.blocker_detected).length === 0 ? 'none detected' : `detected (${evsByEventType(EVT.blocker_detected).length})`,
  };

  const report: DeliveredReport = {
    id: crypto.randomUUID(),
    scheduledReportId: crypto.randomUUID(),
    deliveredAt: now.toISOString(),
    format: 'markdown',
    summary: { narrative, data: { contributors: contributorsData, teams: [], general } },
  };

  return report;
}

/** Executive summary (weekly, per-org) — FR-4.5 */
export async function generateExecutiveSummaryReport(
  cfg: ReportGeneratorConfig,
  orgId: string
): Promise<DeliveredReport> {
  const now = new Date();
  const days = 7;
  const end = now.toISOString();
  const start = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const events = await devDynamicsRepository.getActivities(orgId, { startTime: start, endTime: end });
  const contributors = await devDynamicsRepository.getAllContributors();

  // PerStepModelAssignments (visibility beyond built-in routing)
  const runtimeAssignments = (global as any).runtime || []; // as Prior pass: PerStepModelAssignments

  const top: { contributorId: string; commits: number; prsMerged: number; issuesClosed: number }[] = [];
  const byC = new Map<string, { commits: number; prsMerged: number; issuesClosed: number }>();
  for (const ev of events) {
    const cur = byC.get(ev.contributorId) || { commits: 0, prsMerged: 0, issuesClosed: 0 };
    if (ev.eventType === 'commit_push') cur.commits++;
    else if (ev.eventType === 'pr_merged') cur.prsMerged++;
    else if (ev.eventType === 'jira_issue_updated' || ev.eventType === 'jira_issue_closed') cur.issuesClosed++;
    byC.set(ev.contributorId, cur);
  }
  for (const [cId, m] of byC) {
    top.push({ contributorId: cId, commits: m.commits, prsMerged: m.prsMerged, reviews: m.reviews });
  }
  top.sort((a, b) => b.commits + b.prsMerged - (a.commits + a.prsMerged));

  const narrative = generateDraftExecutiveSummary(events.length, top, runtimeAssignments);

  const report: DeliveredReport = {
    id: crypto.randomUUID(),
    scheduledReportId: crypto.randomUUID(),
    deliveredAt: now.toISOString(),
    format: 'markdown',
    summary: { narrative, data: { contributors: [], teams: [], general: {} } },
  };

  return report;
}

/** Helpers */
function evsByEventType(EVT: typeof EVT, events?: ActivityEvent[]): ActivityEvent[] {
  const all = events ?? ((global as any).eventsCache) ?? [];
  return all.filter(e => e.eventType === EVT);
}

const EVT = {
  commit_push: 'commit_push',
  pr_merged: 'pr_merged',
  pr_closed: 'pr_closed',
  jira_issue_updated: 'jira_issue_updated',
  jira_issue_closed: 'jira_issue_closed',
  jira_comment_added: 'jira_comment_added',
  blocker_detected: 'blocker_detected',
  pr_opened: 'pr_opened',
  pr_reviewed: 'pr_reviewed',
} as const;

function generateDraftStandupNarrative(contributors: ReportData['contributors'], teams: string[], assignments: PerStepModelAssignmentsMap | null): string {
  const top = [...contributors].sort((a, b) => (b.commitsLast24h + b.prMergedLast24h) - (a.commitsLast24h + a.prMergedLast24h)).slice(0, 5);
  const lines = ['# Daily Standup', `**Generated at:** ${new Date().toISOString()}`, '', '## Top Contributors (Last 24h)', top.map(c => `- ${c.displayName}: ${c.commitsLast24h} commits, ${c.prMergedLast24h} PRs merged, ${c.blockersDetected} blockers`).join('\n'), '', '## Activity Breakdown', `Total: ${contributors.reduce((s, c) => s + c.commitsLast24h + c.prMergedLast24h + c.prReviewedLast24h, 0)} events`], '## Notes', ' (Use LLM assistant to turn this into DSL narrative per org; see prd).'];
  return lines.join('\n');
}

function generateDraftExecutiveSummary(totalEvents: number, top: any[], runtimeAssignments: any[]): string {
  const topContributorsStr = top.slice(0, 3).map(c => `${c.displayName} (${c.commits})`).join(', ');
  const lines = ['# Weekly Executive Summary (Generated: ' + new Date().toISOString() + ')', '## Summary', `Total reported events (last 7d): ${totalEvents}`, `Top contributors by commits (last 7d): ${topContributorsStr}`, '', '## Notes', ' (Use LLM assistant for narrative and filtering; see FR-4.8).'];
  return lines.join('\n');
}

/** Transform parsed Puppeteer/PDF stub to structured PDF output (future) */
export async function asPdfReport(report: DeliverableReport): Promise<Blob> {
  // TODO: seed puppeteer/chromium-pdf policies approved; replace with real PDF rendering
  console.log('PDF stub: conversion not implemented; returning empty Blob. Report type:', report.format);
  return new Blob(['PRD FR-4.7: PDF export integration requires server-side rendering (Puppeteer) and LLM narrative (FR-4.8). To complete, wire actual PDF generation into report.generateDailyStandupReport (or report.generateExecutiveSummaryReport) and a /api/reports/:eventId/pdf endpoint.']);
}

/** Scheduler stub (reconcile persisted schedules) */
export async function reconcileScheduledReports(schedules: ScheduledReport[]): Promise<void> {
  // TODO: interval-loop; cron.deps, trigger reports where nextRunAt <= now and enabled=true
  console.log('Scheduler stub: reconcile ran; no actual triggers.');
}