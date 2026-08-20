/**
 * `hr.performance_review` — where a review cycle actually stands, per person.
 *
 * ── WHY THIS IS A STATE REPORT AND NOT A REVIEW WRITER ───────────────────────
 * The obvious shape for a tool with this name is "write the review". It is the
 * wrong shape, and not marginally: a performance review is a record with
 * employment consequences, and a paragraph a model produced from a roster row —
 * a title, a department and a start date — is an assessment of nothing. What the
 * model needs, and what nobody in an HR team can get without a week of chasing,
 * is the STATE: who is in the cycle, who is out and why, which manager has not
 * finished, and whether the ratings that came back are distributed like a real
 * assessment or like a formality.
 *
 * The narrative is the calling model's job, from evidence a person supplies —
 * the same division the whole career catalog holds to.
 *
 * ── ELIGIBILITY IS A FINDING, NOT A FILTER ───────────────────────────────────
 * Someone who joined three weeks before the cycle closes cannot be fairly rated,
 * and quietly dropping them makes coverage look like 100%. So they appear, with
 * `eligible: false` and the reason, and coverage is computed over the eligible
 * population with the ineligible count stated beside it.
 *
 * Pure: rows in, rows out, `now` passed by the caller.
 */

import { avg } from '../shared/stats';
import { employed } from './orgReview';
import type { RosterPerson } from './roster';

/** Tenure below which a person cannot be fairly rated for a cycle. */
export const DEFAULT_MIN_TENURE_DAYS = 90;

/** One `people_objective_outcomes` row, flattened to the roster's key. */
export interface ReviewOutcome {
  /** The roster's `externalId` for the person this outcome is about. */
  employeeExternalId: string;
  period: string;
  /** The numeric rating, when one has been recorded. */
  rating: number | null;
  narrative: string | null;
  calibratedBy: string | null;
  /** Set once the outcome is final and can no longer be edited. */
  finalisedAt: string | null;
}

export type ReviewState = 'finalised' | 'rated' | 'started' | 'not_started';

export interface ReviewRow {
  externalId: string;
  name: string;
  title: string | null;
  department: string | null;
  managerExternalId: string | null;
  managerName: string | null;
  eligible: boolean;
  /** Why not, when not. Empty for an eligible person. */
  ineligibleReason: string | null;
  state: ReviewState;
  rating: number | null;
  calibrated: boolean;
  tenureDays: number | null;
}

export interface ManagerLoad {
  managerExternalId: string;
  managerName: string;
  reports: number;
  outstanding: number;
  finalised: number;
}

export interface ReviewCycleState {
  ok: true;
  source: string;
  period: string;
  headcount: number;
  eligible: number;
  ineligible: number;
  finalised: number;
  /** Finalised ÷ eligible. The one number a cycle is run against. */
  coverage: number;
  /** Rated but not finalised — the work that is nearly done. */
  inFlight: number;
  notStarted: number;
  calibrated: number;
  averageRating: number | null;
  /** Rating → how many people got it. Sparse: only ratings that occurred. */
  distribution: Array<{ rating: number; count: number; share: number }>;
  byDepartment: Array<{ department: string; eligible: number; finalised: number; coverage: number; averageRating: number | null }>;
  /** Managers with outstanding reviews, most outstanding first. */
  managerLoad: ManagerLoad[];
  rows: ReviewRow[];
  findings: Array<{ code: string; severity: 'high' | 'medium' | 'low'; headline: string; evidence: string[] }>;
  assumptions: string[];
  instruction: string;
}

const EVIDENCE_CAP = 12;

/**
 * Read the cycle.
 *
 * `outcomes` are matched on the roster's external id, so an outcome for somebody
 * no longer employed simply finds no row — which is correct: a cycle report is
 * about the people who are here to be reviewed.
 */
export function reviewCycleState(input: {
  people: readonly RosterPerson[];
  outcomes: readonly ReviewOutcome[];
  period: string;
  now?: Date;
  minTenureDays?: number;
  source?: string;
}): ReviewCycleState {
  const now = input.now ?? new Date();
  const minTenure = input.minTenureDays ?? DEFAULT_MIN_TENURE_DAYS;
  const roster = employed(input.people);
  const names = new Map(roster.map((p) => [p.externalId, p.name]));
  const forPeriod = input.outcomes.filter((o) => o.period === input.period);
  const byPerson = new Map<string, ReviewOutcome>();
  for (const outcome of forPeriod) {
    // A person can have several objective outcomes in a period (one per
    // objective). The cycle is finished for them when the LAST one is, so a
    // finalised row never overwrites an unfinished one.
    const existing = byPerson.get(outcome.employeeExternalId);
    if (!existing || (existing.finalisedAt && !outcome.finalisedAt)) byPerson.set(outcome.employeeExternalId, outcome);
  }

  const rows: ReviewRow[] = roster.map((person) => {
    const tenureDays = person.startedAt
      ? Math.max(0, Math.round((now.getTime() - Date.parse(person.startedAt)) / 86_400_000))
      : null;
    const tooNew = tenureDays != null && tenureDays < minTenure;
    const outcome = byPerson.get(person.externalId);
    const state: ReviewState = outcome?.finalisedAt ? 'finalised'
      : outcome?.rating != null ? 'rated'
      : outcome ? 'started'
      : 'not_started';
    return {
      externalId: person.externalId,
      name: person.name,
      title: person.title,
      department: person.department,
      managerExternalId: person.managerExternalId,
      managerName: person.managerExternalId ? names.get(person.managerExternalId) ?? null : null,
      eligible: !tooNew && person.status !== 'notice',
      ineligibleReason: tooNew
        ? `joined ${tenureDays} days ago — under the ${minTenure}-day minimum tenure for this cycle`
        : person.status === 'notice' ? 'working notice'
        : null,
      state,
      rating: outcome?.rating ?? null,
      calibrated: !!outcome?.calibratedBy,
      tenureDays,
    };
  });

  const eligibleRows = rows.filter((r) => r.eligible);
  const finalised = eligibleRows.filter((r) => r.state === 'finalised');
  const ratings = eligibleRows.map((r) => r.rating).filter((r): r is number => typeof r === 'number');

  const distributionMap = new Map<number, number>();
  for (const rating of ratings) distributionMap.set(rating, (distributionMap.get(rating) ?? 0) + 1);
  const distribution = [...distributionMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rating, count]) => ({ rating, count, share: ratings.length ? count / ratings.length : 0 }));

  const departments = [...new Set(eligibleRows.map((r) => r.department ?? 'Unassigned'))].sort();
  const byDepartment = departments.map((department) => {
    const members = eligibleRows.filter((r) => (r.department ?? 'Unassigned') === department);
    const done = members.filter((r) => r.state === 'finalised');
    const scored = members.map((r) => r.rating).filter((r): r is number => typeof r === 'number');
    return {
      department,
      eligible: members.length,
      finalised: done.length,
      coverage: members.length ? done.length / members.length : 0,
      averageRating: avg(scored),
    };
  });

  const managerIds = [...new Set(eligibleRows.map((r) => r.managerExternalId).filter((id): id is string => !!id))];
  const managerLoad: ManagerLoad[] = managerIds
    .map((managerExternalId) => {
      const reports = eligibleRows.filter((r) => r.managerExternalId === managerExternalId);
      return {
        managerExternalId,
        managerName: names.get(managerExternalId) ?? managerExternalId,
        reports: reports.length,
        outstanding: reports.filter((r) => r.state !== 'finalised').length,
        finalised: reports.filter((r) => r.state === 'finalised').length,
      };
    })
    .filter((m) => m.outstanding > 0)
    .sort((a, b) => b.outstanding - a.outstanding || a.managerName.localeCompare(b.managerName));

  const findings: ReviewCycleState['findings'] = [];
  const noManager = eligibleRows.filter((r) => !r.managerExternalId);
  if (noManager.length) {
    findings.push({
      code: 'no_reviewer',
      severity: 'high',
      headline: `${noManager.length} eligible ${noManager.length === 1 ? 'person has' : 'people have'} no manager on the roster, so nobody owns their review.`,
      evidence: noManager.slice(0, EVIDENCE_CAP).map((r) => `${r.name}${r.title ? ` — ${r.title}` : ''}`),
    });
  }
  const stalled = managerLoad.filter((m) => m.finalised === 0 && m.reports > 1);
  if (stalled.length) {
    findings.push({
      code: 'manager_not_started',
      severity: 'high',
      headline: `${stalled.length} ${stalled.length === 1 ? 'manager has' : 'managers have'} not finalised a single review.`,
      evidence: stalled.slice(0, EVIDENCE_CAP).map((m) => `${m.managerName} — 0 of ${m.reports} done`),
    });
  }
  const uncalibrated = finalised.filter((r) => !r.calibrated);
  if (uncalibrated.length) {
    findings.push({
      code: 'uncalibrated',
      severity: 'medium',
      headline: `${uncalibrated.length} of ${finalised.length} finalised ${uncalibrated.length === 1 ? 'review' : 'reviews'} went through with no calibrator recorded.`,
      evidence: uncalibrated.slice(0, EVIDENCE_CAP).map((r) => `${r.name} — rating ${r.rating ?? 'none'}, no calibrator`),
    });
  }
  // A cycle where nearly everybody lands on one rating is a cycle that measured
  // compliance rather than performance. It is reported as a shape, without a
  // verdict on whether the ratings are "right" — nothing here can know that.
  const dominant = distribution.find((d) => d.share >= 0.8);
  if (dominant && ratings.length >= 5) {
    findings.push({
      code: 'flat_distribution',
      severity: 'medium',
      headline: `${Math.round(dominant.share * 100)}% of ratings are ${dominant.rating}. A cycle this concentrated carries no information for pay or promotion decisions.`,
      evidence: distribution.map((d) => `${d.rating}: ${d.count} (${Math.round(d.share * 100)}%)`),
    });
  }
  const lopsided = byDepartment.filter((d) => d.eligible >= 3 && d.coverage === 0);
  if (lopsided.length) {
    findings.push({
      code: 'department_not_started',
      severity: 'medium',
      headline: `${lopsided.length} ${lopsided.length === 1 ? 'department has' : 'departments have'} not finalised anything.`,
      evidence: lopsided.slice(0, EVIDENCE_CAP).map((d) => `${d.department} — 0 of ${d.eligible}`),
    });
  }

  return {
    ok: true,
    source: input.source ?? 'unknown',
    period: input.period,
    headcount: roster.length,
    eligible: eligibleRows.length,
    ineligible: rows.length - eligibleRows.length,
    finalised: finalised.length,
    coverage: eligibleRows.length ? finalised.length / eligibleRows.length : 0,
    inFlight: eligibleRows.filter((r) => r.state === 'rated' || r.state === 'started').length,
    notStarted: eligibleRows.filter((r) => r.state === 'not_started').length,
    calibrated: eligibleRows.filter((r) => r.calibrated).length,
    averageRating: avg(ratings),
    distribution,
    byDepartment,
    managerLoad,
    rows,
    findings,
    assumptions: [
      `Only outcomes for period "${input.period}" were read; ${input.outcomes.length - forPeriod.length} row(s) belong to other periods.`,
      `Eligibility requires ${minTenure} days of tenure and excludes anybody working notice. Ineligible people are listed with their reason rather than hidden.`,
      'A person with several objective outcomes in the period counts as finished only when every one of them is finalised.',
      'Ratings are whatever scale this workspace records; nothing here normalises or re-bands them.',
    ],
    instruction:
      'Lead with `coverage` and the named managers in `managerLoad` — a cycle report exists to move the outstanding work, and a '
      + 'percentage with no names attached moves nothing. Do NOT write, draft or suggest review NARRATIVE for any individual: a '
      + 'roster row is not evidence of performance, and text produced from one enters somebody\'s employment record. If asked for '
      + 'narrative help, ask the manager for their own observations first and help them structure those.',
  };
}
