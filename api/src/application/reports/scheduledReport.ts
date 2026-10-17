/**
 * The scheduled-report generator the cron dispatcher (`runDueReports`) is wired with
 * at the composition root. Lives in application (not the route module) so the
 * dispatcher and the on-demand GETs share one set of generators.
 */

import type { Db } from '../../infrastructure/database/connection';
import { buildBoardPackReport } from '../finance/boardPackReport';
import { buildExecutiveSummary } from './executiveSummary';
import { generateProjectStatusReport } from './projectStatusReport';
import { generateCodeReviewReport, generateStandupReport } from './devActivityReports';
import { generatePortfolioReport } from './portfolioReport';

const REPORT_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dispatch a schedulable report_type → its generator, returning an email-ready
 * { subject, report }. Reuses the on-demand generators (single source of
 * generation logic — the scheduled dispatcher and the GET endpoints never drift).
 * Returns null for report types without a generator, so the sweep can skip them
 * cleanly.
 */
export async function buildScheduledReport(
  db: Db,
  reportType: string,
  tenantId: number,
  segmentId: string,
  now: Date,
  /** What the schedule is ABOUT, for the types that need a subject (mig 0461). The
   *  five computed types ignore it; a `board_pack` cannot be built without it. */
  subject?: { subjectKind: string | null; subjectRef: string | null },
): Promise<{ subject: string; report: Record<string, unknown> } | null> {
  switch (reportType) {
    case 'standup':
      return { subject: '[Builderforce] Daily standup report', report: await generateStandupReport(db, tenantId, now) };
    case 'code_review':
      return { subject: '[Builderforce] Code review report', report: await generateCodeReviewReport(db, tenantId, new Date(now.getTime() - 14 * REPORT_DAY_MS), now) };
    case 'executive_summary':
      return { subject: '[Builderforce] Executive summary', report: await buildExecutiveSummary(db, tenantId, new Date(now.getTime() - 30 * REPORT_DAY_MS), now) as unknown as Record<string, unknown> };
    case 'portfolio_rollup':
      return { subject: '[Builderforce] Portfolio (PMO) rollup', report: await generatePortfolioReport(db, tenantId, segmentId) };
    case 'project_status':
      return { subject: '[Builderforce] Project status digest', report: await generateProjectStatusReport(db, tenantId, segmentId) as unknown as Record<string, unknown> };
    case 'board_pack':
      // The first report type that is ABOUT something. Returns null for a frame that
      // has been deleted or emptied, which the dispatcher treats as "nothing to send"
      // while still advancing the watermark — so a board someone removed stops mailing
      // the investors rather than mailing them a blank page every month.
      return buildBoardPackReport(db, tenantId, subject?.subjectKind ?? null, subject?.subjectRef ?? null, now);
    default:
      return null;
  }
}
