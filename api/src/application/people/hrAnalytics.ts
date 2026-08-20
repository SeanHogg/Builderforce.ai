/**
 * The four analytical reads, composed.
 *
 * Each one is the same three lines — ask the port, refuse if there is no roster,
 * hand the rows to the pure function — and they live here rather than in the tool
 * handlers so that the refusal path is written ONCE. It is the path these tools
 * take most often (most workspaces have no HRIS connected), it is the path that
 * must never invent a number, and four hand-written copies of it is four chances
 * for one of them to fall through to a computation over an empty array and report
 * a company of zero people as a clean org.
 */

import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { fetchBands, fetchCompensation, fetchRequisitions, fetchReviewOutcomes, fetchRoster, type PortRead } from './hrmsPort';
import { planHeadcount, type HeadcountPlan } from './headcountPlan';
import { reviewCycleState, type ReviewCycleState } from './performanceReview';
import { reviewOrg, type OrgReview } from './orgReview';
import { assessTeamHealth, type TeamHealthReport } from './teamHealth';
import { hrmsRefusal, type HrmsRefusal, type RosterPerson } from './roster';

/** The roster read, or the refusal that replaces every one of these tools' output. */
async function requireRoster(
  db: Db,
  env: Env,
  tenantId: number,
  connectorKey?: string | null,
): Promise<PortRead<RosterPerson> | HrmsRefusal> {
  const read = await fetchRoster(db, env, tenantId, { connectorKey });
  if (!read.source) return hrmsRefusal({ reason: 'no_roster_source', connectedSources: read.connectedSources });
  if (read.error) {
    return hrmsRefusal({ reason: 'provider_error', connectedSources: read.connectedSources, providerError: read.error });
  }
  if (!read.rows.length) return hrmsRefusal({ reason: 'empty_roster', connectedSources: read.connectedSources });
  return read;
}

const refused = (value: PortRead<RosterPerson> | HrmsRefusal): value is HrmsRefusal =>
  (value as HrmsRefusal).ok === false;

/** `hr.org_review` — spans and layers. */
export async function orgReview(
  db: Db,
  env: Env,
  tenantId: number,
  options: { connectorKey?: string | null; wideSpan?: number } = {},
): Promise<OrgReview | HrmsRefusal> {
  const read = await requireRoster(db, env, tenantId, options.connectorKey);
  if (refused(read)) return read;
  return reviewOrg(read.rows, { source: read.source!, wideSpan: options.wideSpan });
}

/** `hr.headcount_plan` — requisitions and bands costed against the roster. */
export async function headcountPlan(
  db: Db,
  env: Env,
  tenantId: number,
  options: { connectorKey?: string | null; currency?: string; employerLoad?: number; daysToFill?: number } = {},
): Promise<(HeadcountPlan & { requisitionSources: string[]; requisitionError: string | null }) | HrmsRefusal> {
  const read = await requireRoster(db, env, tenantId, options.connectorKey);
  if (refused(read)) return read;
  const [requisitions, compensation, bands] = await Promise.all([
    fetchRequisitions(db, env, tenantId),
    fetchCompensation(db, env, tenantId),
    fetchBands(db, tenantId),
  ]);
  const plan = planHeadcount({
    people: read.rows,
    requisitions: requisitions.rows,
    bands,
    compensation: compensation.rows,
    currency: options.currency,
    employerLoad: options.employerLoad,
    daysToFill: options.daysToFill,
    source: read.source!,
  });
  return {
    ...plan,
    requisitionSources: requisitions.source ? [requisitions.source] : [],
    requisitionError: requisitions.error,
    assumptions: [
      ...plan.assumptions,
      bands.length
        ? `${bands.length} compensation band(s) are published in this workspace.`
        : 'No compensation bands are published, so nothing could be priced from a band. Every costed line came from a department median.',
      requisitions.source
        ? `Requisitions came from ${requisitions.source}${requisitions.rows.some((r) => r.source === 'platform') ? ' and this workspace\'s own open positions' : ''}.`
        : 'No applicant-tracking system is connected; only this workspace\'s own open positions were read.',
    ],
  };
}

/** `hr.performance_review` — where the cycle stands. */
export async function performanceReview(
  db: Db,
  env: Env,
  tenantId: number,
  options: { period: string; connectorKey?: string | null; minTenureDays?: number },
): Promise<ReviewCycleState | HrmsRefusal> {
  const read = await requireRoster(db, env, tenantId, options.connectorKey);
  if (refused(read)) return read;
  const outcomes = await fetchReviewOutcomes(db, tenantId, options.period);
  return reviewCycleState({
    people: read.rows,
    outcomes,
    period: options.period,
    minTenureDays: options.minTenureDays,
    source: read.source!,
  });
}

/** `hr.team_health` — the four signals a roster can honestly carry. */
export async function teamHealth(
  db: Db,
  env: Env,
  tenantId: number,
  options: { connectorKey?: string | null; windowMonths?: number } = {},
): Promise<TeamHealthReport | HrmsRefusal> {
  const read = await requireRoster(db, env, tenantId, options.connectorKey);
  if (refused(read)) return read;
  const compensation = await fetchCompensation(db, env, tenantId);
  // The FULL set, leavers included: attrition cannot be measured from the people
  // who are still here, and `assessTeamHealth` says so in its own header.
  return assessTeamHealth({
    people: read.rows,
    compensation: compensation.rows,
    windowMonths: options.windowMonths,
    source: read.source!,
  });
}
