/**
 * `hr.team_health` — the four signals a roster can honestly carry, per team.
 *
 * ── WHAT A ROSTER CAN AND CANNOT SEE ─────────────────────────────────────────
 * It cannot see morale, psychological safety, workload or whether a team likes
 * its manager. Every product that claims to score those from an HRIS export is
 * scoring something else and calling it health. What a roster CAN see, exactly
 * and without inference, is four structural facts:
 *
 *   TENURE     — how long the team has been together, and how much of it is new.
 *   SPAN       — how many people one manager is carrying.
 *   ATTRITION  — who left, in the last twelve months, from this team.
 *   COMPRESSION — whether recent hires are paid at or above the people they joined.
 *
 * Those four are worth having on their own. A team that lost a third of its people
 * and back-filled with joiners paid above the survivors has a specific, nameable
 * problem, and the four numbers say so without anybody guessing at a mood.
 *
 * ── THE SCORE IS A SUM OF NAMED SIGNALS, NEVER A BLACK BOX ───────────────────
 * `risk` is returned with `signals` — each contributing signal, its measured
 * value, and the weight it carried. A single number nobody can decompose is the
 * thing that gets argued with in a meeting and cannot be defended; this one can
 * be taken apart on the spot, and a reader who disagrees with a weight can see
 * exactly which one to argue about.
 *
 * Pure: rows in, rows out, `now` from the caller.
 */

import { avg, median } from '../shared/stats';
import type { CompensationRecord, RosterPerson } from './roster';

/** Months of history the attrition window looks back over. */
export const ATTRITION_WINDOW_MONTHS = 12;

/** Tenure under this many months makes somebody a "recent joiner". */
export const RECENT_JOINER_MONTHS = 6;

/** Compression is flagged once recent hires' median pay reaches this share of
 *  the tenured median. At 1.0 the newcomers match people with years on them. */
export const COMPRESSION_THRESHOLD = 0.98;

export interface HealthSignal {
  key: 'attrition' | 'span' | 'new_joiner_load' | 'compression' | 'no_manager' | 'single_person_team';
  /** The measured value, in the signal's own units — always reported. */
  value: number;
  /** What it contributed to `risk`, 0–1 of the total. */
  weight: number;
  note: string;
}

export interface TeamHealth {
  team: string;
  headcount: number;
  managers: number;
  /** Reports per manager in this team. `null` when the team has no manager. */
  span: number | null;
  medianTenureMonths: number | null;
  recentJoiners: number;
  recentJoinerShare: number;
  leaversInWindow: number;
  /** Leavers ÷ average headcount over the window. */
  attritionRate: number;
  /** Recent hires' median pay ÷ tenured median pay. `null` without compensation. */
  compressionRatio: number | null;
  medianBaseCents: number | null;
  /** 0–1. The sum of `signals`, and nothing else. */
  risk: number;
  signals: HealthSignal[];
}

export interface TeamHealthReport {
  ok: true;
  source: string;
  windowMonths: number;
  headcount: number;
  leaversInWindow: number;
  overallAttritionRate: number;
  hasCompensation: boolean;
  teams: TeamHealth[];
  findings: Array<{ code: string; severity: 'high' | 'medium' | 'low'; headline: string; evidence: string[] }>;
  assumptions: string[];
  instruction: string;
}

const MONTH_MS = 30.44 * 86_400_000;
const EVIDENCE_CAP = 12;

const monthsBetween = (from: string | null, to: Date): number | null => {
  if (!from) return null;
  const parsed = Date.parse(from);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, (to.getTime() - parsed) / MONTH_MS);
};

/**
 * Assess every team.
 *
 * A "team" is the department, because that is the grouping every one of the six
 * roster providers actually carries. Grouping by manager instead would be finer
 * and would fragment on every unresolved manager id — a defect `orgReview`
 * reports rather than one this module should silently inherit.
 *
 * `people` must include LEAVERS: attrition cannot be measured from a list of the
 * people who are still here, and passing the employed-only roster produces a
 * confident zero. The port passes the full set for exactly this reason.
 */
export function assessTeamHealth(input: {
  people: readonly RosterPerson[];
  compensation?: readonly CompensationRecord[];
  now?: Date;
  windowMonths?: number;
  source?: string;
}): TeamHealthReport {
  const now = input.now ?? new Date();
  const windowMonths = input.windowMonths ?? ATTRITION_WINDOW_MONTHS;
  const windowStart = now.getTime() - windowMonths * MONTH_MS;
  const comp = new Map((input.compensation ?? [])
    .filter((c) => typeof c.annualBaseCents === 'number' && c.annualBaseCents > 0)
    .map((c) => [c.externalId, c.annualBaseCents!]));

  const current = input.people.filter((p) => p.status !== 'terminated');
  const leavers = input.people.filter((p) =>
    p.status === 'terminated' && p.endedAt != null && Date.parse(p.endedAt) >= windowStart);

  const managerIds = new Set(current.map((p) => p.managerExternalId).filter((id): id is string => !!id));
  const teamNames = [...new Set([
    ...current.map((p) => p.department ?? 'Unassigned'),
    ...leavers.map((p) => p.department ?? 'Unassigned'),
  ])].sort();

  const teams: TeamHealth[] = teamNames.map((team) => {
    const members = current.filter((p) => (p.department ?? 'Unassigned') === team);
    const gone = leavers.filter((p) => (p.department ?? 'Unassigned') === team);
    const managers = members.filter((p) => managerIds.has(p.externalId)).length;
    const tenures = members.map((p) => monthsBetween(p.startedAt, now)).filter((t): t is number => t != null);
    const recent = tenures.filter((t) => t < RECENT_JOINER_MONTHS).length;

    // Average headcount over the window: the survivors plus half of everyone who
    // left. Dividing leavers by the CURRENT headcount overstates attrition badly
    // in a team that shrank — which is precisely the team the number is about.
    const averageHeadcount = members.length + gone.length / 2;
    const attritionRate = averageHeadcount > 0 ? gone.length / averageHeadcount : 0;

    const paid = members
      .map((p) => ({ tenure: monthsBetween(p.startedAt, now), pay: comp.get(p.externalId) }))
      .filter((row): row is { tenure: number | null; pay: number } => typeof row.pay === 'number');
    const newPay = paid.filter((r) => r.tenure != null && r.tenure < 12).map((r) => r.pay);
    const tenuredPay = paid.filter((r) => r.tenure != null && r.tenure >= 24).map((r) => r.pay);
    const newMedian = median(newPay);
    const tenuredMedian = median(tenuredPay);
    const compressionRatio = newMedian != null && tenuredMedian != null && tenuredMedian > 0
      ? newMedian / tenuredMedian
      : null;

    const span = managers > 0 ? (members.length - managers) / managers : null;
    const signals: HealthSignal[] = [];
    if (attritionRate > 0.15) {
      signals.push({
        key: 'attrition',
        value: attritionRate,
        weight: Math.min(0.35, attritionRate),
        note: `${gone.length} of an average ${averageHeadcount.toFixed(1)} left in ${windowMonths} months.`,
      });
    }
    if (span != null && span > 10) {
      signals.push({
        key: 'span',
        value: span,
        weight: Math.min(0.2, (span - 10) / 40),
        note: `${span.toFixed(1)} reports per manager.`,
      });
    }
    if (members.length && recent / members.length > 0.4) {
      signals.push({
        key: 'new_joiner_load',
        value: recent / members.length,
        weight: 0.15,
        note: `${recent} of ${members.length} joined in the last ${RECENT_JOINER_MONTHS} months — most of the team is still ramping.`,
      });
    }
    if (compressionRatio != null && compressionRatio >= COMPRESSION_THRESHOLD) {
      signals.push({
        key: 'compression',
        value: compressionRatio,
        weight: 0.2,
        note: `Hires from the last year sit at ${Math.round(compressionRatio * 100)}% of the median for people with two years or more.`,
      });
    }
    if (members.length > 1 && managers === 0) {
      signals.push({ key: 'no_manager', value: members.length, weight: 0.1, note: 'No manager inside this team.' });
    }
    if (members.length === 1) {
      signals.push({ key: 'single_person_team', value: 1, weight: 0.1, note: 'One person carries this whole area.' });
    }

    return {
      team,
      headcount: members.length,
      managers,
      span,
      medianTenureMonths: median(tenures),
      recentJoiners: recent,
      recentJoinerShare: members.length ? recent / members.length : 0,
      leaversInWindow: gone.length,
      attritionRate,
      compressionRatio,
      medianBaseCents: median(paid.map((r) => r.pay)),
      risk: Math.min(1, signals.reduce((total, s) => total + s.weight, 0)),
      signals,
    };
  }).sort((a, b) => b.risk - a.risk || b.headcount - a.headcount);

  const overallAverage = current.length + leavers.length / 2;
  const findings: TeamHealthReport['findings'] = [];
  const bleeding = teams.filter((t) => t.attritionRate > 0.25 && t.leaversInWindow >= 2);
  if (bleeding.length) {
    findings.push({
      code: 'high_attrition',
      severity: 'high',
      headline: `${bleeding.length} ${bleeding.length === 1 ? 'team has' : 'teams have'} lost more than a quarter of their people in ${windowMonths} months.`,
      evidence: bleeding.slice(0, EVIDENCE_CAP).map((t) => `${t.team} — ${t.leaversInWindow} left, ${t.headcount} remain`),
    });
  }
  const compressed = teams.filter((t) => t.compressionRatio != null && t.compressionRatio >= COMPRESSION_THRESHOLD);
  if (compressed.length) {
    findings.push({
      code: 'pay_compression',
      severity: 'high',
      headline: `${compressed.length} ${compressed.length === 1 ? 'team pays' : 'teams pay'} its recent hires at or above its tenured people.`,
      evidence: compressed.slice(0, EVIDENCE_CAP).map((t) => `${t.team} — new hires at ${Math.round(t.compressionRatio! * 100)}% of the two-year-plus median`),
    });
  }
  const green = teams.filter((t) => t.headcount >= 3 && t.recentJoinerShare > 0.5);
  if (green.length) {
    findings.push({
      code: 'mostly_new',
      severity: 'medium',
      headline: `${green.length} ${green.length === 1 ? 'team is' : 'teams are'} more than half new joiners.`,
      evidence: green.slice(0, EVIDENCE_CAP).map((t) => `${t.team} — ${t.recentJoiners} of ${t.headcount} joined in the last ${RECENT_JOINER_MONTHS} months`),
    });
  }
  const alone = teams.filter((t) => t.headcount === 1);
  if (alone.length) {
    findings.push({
      code: 'single_person_team',
      severity: 'medium',
      headline: `${alone.length} ${alone.length === 1 ? 'area is' : 'areas are'} carried by exactly one person.`,
      evidence: alone.slice(0, EVIDENCE_CAP).map((t) => t.team),
    });
  }

  return {
    ok: true,
    source: input.source ?? 'unknown',
    windowMonths,
    headcount: current.length,
    leaversInWindow: leavers.length,
    overallAttritionRate: overallAverage > 0 ? leavers.length / overallAverage : 0,
    hasCompensation: comp.size > 0,
    teams,
    findings,
    assumptions: [
      'A team is a department, because that is the grouping every roster provider carries. Grouping by manager fragments on any unresolved manager id.',
      `Attrition is leavers in the last ${windowMonths} months over the average headcount across that window (survivors + half the leavers), not over today's headcount.`,
      `Compression compares the median base of people under 12 months' tenure to the median of people at 24 months or more; a team without both groups reports null rather than a number.`,
      comp.size > 0
        ? `Compensation was read for ${comp.size} people; anybody whose pay could not be read is excluded from the pay medians rather than counted as zero.`
        : 'No compensation was readable, so every compression figure is null. Connect a payroll provider to populate them.',
      'Nothing here measures morale, workload or engagement. A roster cannot see those, and a number claiming to would be invented.',
    ],
    instruction:
      'Present `signals` alongside `risk` every time — the score is the sum of those named signals and nothing else, and a reader must be '
      + 'able to take it apart. Say explicitly which of the four signals is MISSING for a team (compression is null without payroll '
      + 'connected, tenure is null without start dates) rather than letting a low risk score read as a clean bill of health. Never '
      + 'characterise a team\'s morale, engagement or happiness: this data cannot see any of them, and the reader will assume it did.',
  };
}
