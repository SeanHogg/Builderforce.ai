/**
 * Feedback-submission accounting — the Product Feedback pillar's half of the
 * consumption framework, mirroring application/quality/errorEventsLedger.ts.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Feedback ingestion used to be bounded by ONE number: the collector's rolling-24h
 * `daily_limit`. That is an abuse ceiling on a single key, and it is the wrong
 * instrument for two reasons. It is per-collector, so a tenant with several
 * projects (or a provider webhook, which carries no collector key of its own) has
 * no ceiling at all in aggregate; and it is plan-blind, so a free workspace and an
 * enterprise one are metered identically while every accepted request writes a row
 * and can open a backlog ticket. The result was a metered pillar with no meter:
 * nothing month-to-date to SHOW a member, and nothing plan-scoped to ENFORCE.
 *
 * `sumTenantFeedbackSubmissions` is THE single accountant for "feedback submissions
 * in a window" (shared by the consumption meter and the ingest gate);
 * `enforceFeedbackSubmissionsCap` is the request-path gate that refuses NEW
 * submissions once a tenant is over its monthly allowance. Count is the metered
 * quantity — one recorded submission is one unit, whichever channel it arrived on,
 * because the cost the cap is protecting (a row plus a human's triage attention) is
 * per-request and channel-independent.
 *
 * The rolling-24h ceiling STAYS. The two are different instruments against different
 * failures: burst abuse of one public key, versus sustained plan-scoped volume.
 * A deduped submission consumes NEITHER — it never becomes a row.
 */

import { feedbackSubmissions } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { resolveFeedbackSubmissionsMonthly } from '../../domain/tenant/PlanLimits';
import { enforceMonthlyTenantCap, type MonthlyTenantCapResult } from '../shared/monthlyTenantCap';
import { dailyTenantCounts, sumTenantRowCount, type DailyCount } from '../shared/dailyTenantCounts';

/**
 * The rows that count as one metered submission — every recorded request,
 * including a DECLINED one. Declining is a triage verdict reached after the row was
 * written and a human read it; refunding it would make the meter re-write history
 * and let a tenant mine the quota by filing requests they expect to be rejected.
 */
const FEEDBACK_SUBMISSION_ROWS = {
  table: feedbackSubmissions,
  tenantColumn: feedbackSubmissions.tenantId,
  createdAtColumn: feedbackSubmissions.createdAt,
} as const;

/** Per-day feedback-submission count since `since` (UTC day buckets, sparse). Day
 *  totals sum to {@link sumTenantFeedbackSubmissions}; drives the meter sparkline. */
export async function dailyTenantFeedbackSubmissions(db: Db, tenantId: number, since: Date): Promise<DailyCount[]> {
  return dailyTenantCounts(db, tenantId, since, FEEDBACK_SUBMISSION_ROWS);
}

/** Feedback submissions recorded for a tenant since `since` — the single window
 *  total the meter and the gate share. */
export async function sumTenantFeedbackSubmissions(db: Db, tenantId: number, since: Date): Promise<number> {
  return sumTenantRowCount(db, tenantId, since, FEEDBACK_SUBMISSION_ROWS);
}

export type FeedbackSubmissionsCapResult = MonthlyTenantCapResult;

/**
 * Gate a NEW feedback submission against the tenant's monthly allowance.
 * Self-contained (resolves plan + limit + month-to-date count from the tenantId).
 * Unlimited plans (and superadmin-unlimited tenants) always pass. Fails OPEN on a
 * query error — a metering hiccup must not silently swallow a customer's request,
 * which is the one class of data this pillar exists to not lose.
 */
export async function enforceFeedbackSubmissionsCap(db: Db, tenantId: number, env?: Env): Promise<FeedbackSubmissionsCapResult> {
  return enforceMonthlyTenantCap({
    db,
    tenantId,
    env,
    resolveLimit: resolveFeedbackSubmissionsMonthly,
    sumUsage: sumTenantFeedbackSubmissions,
  });
}
