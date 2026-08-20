/**
 * `hr.headcount_plan` — open requisitions, the roster and the bands, costed.
 *
 * ── THE QUESTION IT ANSWERS ──────────────────────────────────────────────────
 * "If we fill everything that is open, what is the headcount and what does it
 * cost?" That is one join across three systems — the ATS knows what is open, the
 * HRIS knows who is here, and the comp bands say what a role pays — and it is the
 * reason this tool could not ship before the connectors did.
 *
 * ── EVERY FIGURE CARRIES ITS BASIS ───────────────────────────────────────────
 * A costed plan built from three sources of wildly different quality must say
 * which one each line came from, so `basis` is on every row: `band` (the
 * workspace's own published band for that role family and level), `band_family`
 * (the family matched and the level did not, so the family midpoint was used),
 * `department_median` (no band, so the median of what people in that department
 * are actually paid), or `uncosted`.
 *
 * ── AND AN UNCOSTED ROLE STAYS UNCOSTED ──────────────────────────────────────
 * The strong temptation is to fill a gap with a plausible market number. That is
 * the failure this whole file set exists to avoid: a hiring plan is taken into a
 * board meeting, and a fabricated salary is indistinguishable from a real one on
 * the slide. So a requisition nothing can price appears in `uncosted` with the
 * reason, the totals exclude it, and `coverage` says what fraction of the plan is
 * actually priced. A partial answer that admits its edges beats a complete answer
 * that does not.
 *
 * Pure: rows in, rows out.
 */

import { median, sum } from '../shared/stats';
import { employed } from './orgReview';
import { isOpenRequisition, type CompensationBand, type CompensationRecord, type Requisition, type RosterPerson } from './roster';

/**
 * Employer cost on top of base pay, as a fraction.
 *
 * Payroll taxes, statutory contributions, benefits and equipment. 25% is the
 * conventional US planning figure and it is WRONG in most other jurisdictions —
 * which is exactly why it is a named, overridable parameter that is echoed back
 * in `assumptions` rather than a constant multiplied in silently. A finance lead
 * reading the output can see the number they need to argue with.
 */
export const DEFAULT_EMPLOYER_LOAD = 0.25;

/** Days from "open" to "started", for the first-year (not run-rate) figure. */
export const DEFAULT_DAYS_TO_FILL = 60;

export type CostBasis = 'band' | 'band_family' | 'department_median' | 'uncosted';

export interface PlannedRole {
  externalId: string;
  title: string;
  department: string | null;
  location: string | null;
  source: string;
  openedAt: string | null;
  /** How long this requisition has been open, when it says. */
  daysOpen: number | null;
  basis: CostBasis;
  /** What the basis matched — a band key, a department, or the reason it did not. */
  basisDetail: string;
  baseCents: number | null;
  /** Base + employer load + bonus at target. The number that hits a budget. */
  loadedAnnualCents: number | null;
}

export interface HeadcountPlan {
  ok: true;
  source: string;
  currency: string;
  currentHeadcount: number;
  openRequisitions: number;
  plannedHeadcount: number;
  /** Annual run-rate of the open roles that could be priced. */
  plannedAnnualCostCents: number;
  /** The same roles' cost in the first twelve months, pro-rated for time-to-fill. */
  firstYearCostCents: number;
  /** Priced roles ÷ open roles. 1 means the whole plan is costed. */
  coverage: number;
  roles: PlannedRole[];
  uncosted: Array<{ title: string; reason: string }>;
  byDepartment: Array<{
    department: string;
    current: number;
    opening: number;
    planned: number;
    /** Growth as a fraction of the department's current size. `null` for a new department. */
    growth: number | null;
    annualCostCents: number;
  }>;
  assumptions: string[];
  instruction: string;
}

/** Currency codes must agree before amounts are added together. */
const sameCurrency = (currency: string, want: string) => currency.toUpperCase() === want.toUpperCase();

/**
 * Normalise a title for matching: lowercase, strip punctuation and the noise
 * words that appear in every requisition and identify nothing.
 */
const NOISE = /\b(senior|snr|sr|junior|jnr|jr|lead|principal|staff|head of|director of|vp of|i{1,3}|iv|[0-9]+)\b/g;
const titleTokens = (title: string): string[] =>
  title.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(NOISE, ' ').split(/\s+/).filter((t) => t.length > 2);

/** The level words a title can carry, longest first so "senior staff" resolves. */
const LEVELS: readonly string[] = [
  'principal', 'director', 'executive', 'senior', 'staff', 'lead', 'junior', 'intern', 'mid', 'associate',
];

/** The level a title declares, or null. */
export function levelFromTitle(title: string): string | null {
  const text = title.toLowerCase();
  for (const level of LEVELS) if (new RegExp(`\\b${level}\\b`).test(text)) return level;
  return null;
}

/** Pick the band that best describes a title, or null with nothing invented. */
export function matchBand(
  title: string,
  bands: readonly CompensationBand[],
  currency: string,
): { band: CompensationBand; basis: 'band' | 'band_family' } | null {
  const tokens = new Set(titleTokens(title));
  const level = levelFromTitle(title);
  const usable = bands.filter((b) => sameCurrency(b.currency, currency) && b.baseMidCents != null);

  const familyMatches = usable.filter((b) =>
    b.roleFamily.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2).some((t) => tokens.has(t)));
  if (!familyMatches.length) return null;

  if (level) {
    const exact = familyMatches.find((b) => b.level.toLowerCase() === level);
    if (exact) return { band: exact, basis: 'band' };
  }
  // No level in the title, or no band at that level. The family midpoint is the
  // honest fallback and it is labelled as one — it is materially less precise,
  // and a reader must be able to see which rows carry it.
  const sorted = [...familyMatches].sort((a, b) => (a.baseMidCents ?? 0) - (b.baseMidCents ?? 0));
  return { band: sorted[Math.floor(sorted.length / 2)]!, basis: 'band_family' };
}

/**
 * Build the costed plan.
 *
 * `compensation` is keyed by the roster's external id, which is why the roster is
 * required even for the pricing half: a department median is the median of the
 * pay of the people IN that department, and only the roster knows who they are.
 */
export function planHeadcount(input: {
  people: readonly RosterPerson[];
  requisitions: readonly Requisition[];
  bands?: readonly CompensationBand[];
  compensation?: readonly CompensationRecord[];
  currency?: string;
  employerLoad?: number;
  daysToFill?: number;
  source?: string;
  now?: Date;
}): HeadcountPlan {
  const currency = (input.currency ?? 'USD').toUpperCase();
  const load = input.employerLoad ?? DEFAULT_EMPLOYER_LOAD;
  const daysToFill = input.daysToFill ?? DEFAULT_DAYS_TO_FILL;
  const now = input.now ?? new Date();
  const roster = employed(input.people);
  const bands = input.bands ?? [];
  const comp = input.compensation ?? [];
  const open = input.requisitions.filter(isOpenRequisition);

  // Department → median actual base, from the people who are in it. Only rows
  // whose pay could be read contribute; a null does not drag a median down.
  const compById = new Map(comp.filter((c) => sameCurrency(c.currency, currency)).map((c) => [c.externalId, c]));
  const departmentMedian = new Map<string, number>();
  for (const department of new Set(roster.map((p) => p.department ?? 'Unassigned'))) {
    const paid = roster
      .filter((p) => (p.department ?? 'Unassigned') === department)
      .map((p) => compById.get(p.externalId)?.annualBaseCents)
      .filter((c): c is number => typeof c === 'number' && c > 0);
    const value = median(paid);
    if (value != null) departmentMedian.set(department, Math.round(value));
  }

  const roles: PlannedRole[] = [];
  const uncosted: Array<{ title: string; reason: string }> = [];
  for (const req of open) {
    const department = req.department;
    const matched = matchBand(req.title, bands, currency);
    const deptKey = department ?? 'Unassigned';
    const deptMedian = departmentMedian.get(deptKey) ?? null;

    let basis: CostBasis = 'uncosted';
    let basisDetail: string;
    let baseCents: number | null = null;
    let bonus = 0;

    if (matched) {
      basis = matched.basis;
      baseCents = matched.band.baseMidCents;
      bonus = (matched.band.bonusPercent ?? 0) / 100;
      basisDetail = `${matched.band.roleFamily} / ${matched.band.level}${matched.band.location ? ` / ${matched.band.location}` : ''}`
        + (matched.basis === 'band_family' ? ' (family midpoint — the title names no level this workspace has a band for)' : '');
    } else if (deptMedian != null) {
      basis = 'department_median';
      baseCents = deptMedian;
      basisDetail = `median actual base in ${deptKey}`;
    } else {
      basisDetail = bands.length
        ? `no published band matches "${req.title}" and nobody in ${deptKey} has readable compensation`
        : `no compensation bands are published in this workspace and nobody in ${deptKey} has readable compensation`;
      uncosted.push({ title: req.title, reason: basisDetail });
    }

    const loaded = baseCents == null ? null : Math.round(baseCents * (1 + bonus) * (1 + load));
    roles.push({
      externalId: req.externalId,
      title: req.title,
      department,
      location: req.location,
      source: req.source,
      openedAt: req.openedAt,
      daysOpen: req.openedAt ? Math.max(0, Math.round((now.getTime() - Date.parse(req.openedAt)) / 86_400_000)) : null,
      basis,
      basisDetail,
      baseCents,
      loadedAnnualCents: loaded,
    });
  }

  const priced = roles.filter((r) => r.loadedAnnualCents != null);
  const plannedAnnualCostCents = sum(priced.map((r) => r.loadedAnnualCents!));
  // A role that starts on day `daysToFill` costs (365 − daysToFill)/365 of its
  // run-rate in the first twelve months. The distinction matters: budgeting the
  // run-rate for year one over-reserves by roughly a sixth at a 60-day fill.
  const proRata = Math.max(0, (365 - daysToFill) / 365);
  const firstYearCostCents = Math.round(plannedAnnualCostCents * proRata);

  const departments = [...new Set([
    ...roster.map((p) => p.department ?? 'Unassigned'),
    ...open.map((r) => r.department ?? 'Unassigned'),
  ])].sort();
  const byDepartment = departments.map((department) => {
    const current = roster.filter((p) => (p.department ?? 'Unassigned') === department).length;
    const rows = roles.filter((r) => (r.department ?? 'Unassigned') === department);
    return {
      department,
      current,
      opening: rows.length,
      planned: current + rows.length,
      growth: current > 0 ? rows.length / current : null,
      annualCostCents: sum(rows.map((r) => r.loadedAnnualCents ?? 0)),
    };
  });

  return {
    ok: true,
    source: input.source ?? 'unknown',
    currency,
    currentHeadcount: roster.length,
    openRequisitions: open.length,
    plannedHeadcount: roster.length + open.length,
    plannedAnnualCostCents,
    firstYearCostCents,
    coverage: open.length ? priced.length / open.length : 1,
    roles: roles.sort((a, b) => (b.loadedAnnualCents ?? -1) - (a.loadedAnnualCents ?? -1)),
    uncosted,
    byDepartment,
    assumptions: [
      `Amounts are in minor units of ${currency}. Requisitions and bands in another currency were excluded rather than converted — there is no exchange rate in this system.`,
      `Employer load of ${Math.round(load * 100)}% is applied on top of base and target bonus (taxes, statutory contributions, benefits, equipment). It is a planning convention, not this workspace's measured rate.`,
      `First-year cost assumes ${daysToFill} days to fill each role; run-rate assumes all of them filled.`,
      `${input.requisitions.length - open.length} requisition(s) were excluded as not open.`,
      'Nothing here models attrition, merit increases, or the roles a plan would need that nobody has opened a requisition for.',
    ],
    instruction:
      'Report `coverage` before any total. A plan that is 60% costed and a plan that is fully costed are different objects, and the '
      + 'total looks identical. Name every entry in `uncosted` and say what would price it — publishing a band for that role family, or '
      + 'connecting payroll so department medians exist. NEVER supply a salary for an uncosted role, not even as an illustration: a '
      + 'figure in this answer will be pasted into a budget. Lead the departmental view with `growth`, not headcount — a department '
      + 'adding 4 onto 5 is the plan\'s real risk and it is invisible in an absolute count.',
  };
}
