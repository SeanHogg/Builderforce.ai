/**
 * LTV TRANCHES (PRD 25 §5.4) — one LTV, CAC and payback per pocket of customers.
 *
 * A single blended LTV is a vanity number: a strong enterprise tier and a leaky
 * self-serve tier average into a figure that describes neither. A tranche is a
 * partition of the customer base (plan, acquisition cohort, channel, segment)
 * that gets its own economics, so the founder sees which pocket pays.
 *
 * Pure: rows in, tranches out. The rows come from the `customerEconomics` port.
 *
 * ── NULL MEANS NOT MEASURED ─────────────────────────────────────────────────
 * Zero churn is an infinite LTV, which is not a number a board can read, so LTV
 * (and everything derived from it) is `null` when churn is zero or missing. A
 * zero-denominator ratio is likewise `null`, never `0`.
 *
 * ── DECLARED ────────────────────────────────────────────────────────────────
 * A tranche is `declared` when ANY of its customers carried a declared (assumed)
 * input rather than an observed one — the claim-to-proof rule `/finance` applies.
 * One assumption in the mix is enough to stop the tranche being called measured.
 */

export const LTV_DIMENSIONS = ['plan', 'cohort', 'channel', 'segment'] as const;
export type LtvDimension = (typeof LTV_DIMENSIONS)[number];

/** Below this LTV:CAC a tranche is the next thing to fix (PRD 25 §5.4). */
export const LTV_CAC_FLOOR = 3;

/** Per-customer unit economics. `churnPct` is MONTHLY churn in percent. */
export interface CustomerEconomicsRow {
  id: string;
  plan: string | null;
  /** 'YYYY-MM' of first payment. */
  cohortMonth: string | null;
  channel: string | null;
  segment: string | null;
  /** Monthly revenue per account, in currency units. */
  arpa: number | null;
  /** Gross margin in percent (0..100). */
  marginPct: number | null;
  /** Monthly churn in percent (0..100). */
  churnPct: number | null;
  /** Acquisition cost of this customer, in currency units. */
  cac: number | null;
  /** True when any of the inputs above is an assumption, not an observation. */
  declared?: boolean;
}

export interface LtvTranche {
  tranche: string;
  customers: number;
  ltv: number | null;
  cac: number | null;
  ratio: number | null;
  paybackMonths: number | null;
  declared: boolean;
}

/** The label a customer with no value on the dimension falls into. */
export const UNASSIGNED_TRANCHE = 'unassigned';

const finite = (n: number | null | undefined): n is number => n != null && Number.isFinite(n);

/** Mean of the finite values, or null when there are none (never 0). */
function mean(values: Array<number | null | undefined>): number | null {
  const xs = values.filter(finite);
  if (!xs.length) return null;
  return xs.reduce((sum, x) => sum + x, 0) / xs.length;
}

function keyOf(row: CustomerEconomicsRow, dimension: LtvDimension): string {
  const raw = dimension === 'plan' ? row.plan
    : dimension === 'cohort' ? row.cohortMonth
    : dimension === 'channel' ? row.channel
    : row.segment;
  const trimmed = raw?.trim();
  return trimmed ? trimmed : UNASSIGNED_TRANCHE;
}

/**
 * LTV = ARPA × margin ÷ churn. `null` when any input is missing or churn is zero.
 * Exported because the blended figure is computed with the same arithmetic.
 */
export function unitLtv(arpa: number | null, marginPct: number | null, churnPct: number | null): number | null {
  if (!finite(arpa) || !finite(marginPct) || !finite(churnPct)) return null;
  if (churnPct <= 0) return null;
  return (arpa * (marginPct / 100)) / (churnPct / 100);
}

/** CAC payback in months = CAC ÷ (ARPA × margin). `null` when the monthly margin is not positive. */
export function unitPaybackMonths(cac: number | null, arpa: number | null, marginPct: number | null): number | null {
  if (!finite(cac) || !finite(arpa) || !finite(marginPct)) return null;
  const monthlyMargin = arpa * (marginPct / 100);
  if (monthlyMargin <= 0) return null;
  return cac / monthlyMargin;
}

function economics(rows: CustomerEconomicsRow[]): Omit<LtvTranche, 'tranche' | 'customers'> {
  // Tranche ARPA / margin / churn / CAC are the means over its customers; LTV is
  // computed from those means (not the mean of per-customer LTVs), so one
  // zero-churn customer cannot make the whole tranche infinite.
  const arpa = mean(rows.map((r) => r.arpa));
  const marginPct = mean(rows.map((r) => r.marginPct));
  const churnPct = mean(rows.map((r) => r.churnPct));
  const cac = mean(rows.map((r) => r.cac));
  const ltv = unitLtv(arpa, marginPct, churnPct);
  return {
    ltv,
    cac,
    ratio: ltv != null && finite(cac) && cac > 0 ? ltv / cac : null,
    paybackMonths: unitPaybackMonths(cac, arpa, marginPct),
    declared: rows.some((r) => r.declared === true),
  };
}

/** The blended (whole-base) economics — what a single vanity LTV would report. */
export function computeBlendedLtv(rows: CustomerEconomicsRow[]): Omit<LtvTranche, 'tranche' | 'customers'> {
  return economics(rows);
}

/**
 * Partition `rows` by `dimension` and compute each tranche's LTV, CAC, ratio and
 * payback. Cohort tranches sort chronologically; the rest by ratio ascending
 * (worst first, `null` last) so the leaky pocket leads the chart.
 */
export function computeLtvTranches(
  rows: CustomerEconomicsRow[],
  opts: { dimension: LtvDimension },
): LtvTranche[] {
  const groups = new Map<string, CustomerEconomicsRow[]>();
  for (const row of rows) {
    const key = keyOf(row, opts.dimension);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  const tranches: LtvTranche[] = [...groups.entries()].map(([tranche, members]) => ({
    tranche,
    customers: members.length,
    ...economics(members),
  }));

  if (opts.dimension === 'cohort') {
    return tranches.sort((a, b) => a.tranche.localeCompare(b.tranche));
  }
  return tranches.sort((a, b) => {
    if (a.ratio == null && b.ratio == null) return a.tranche.localeCompare(b.tranche);
    if (a.ratio == null) return 1;
    if (b.ratio == null) return -1;
    return a.ratio - b.ratio;
  });
}

/** The tranche below 3:1 with the lowest ratio — the next action — or null when none is below. */
export function nextActionTranche(tranches: LtvTranche[]): { tranche: string; ratio: number } | null {
  let worst: { tranche: string; ratio: number } | null = null;
  for (const t of tranches) {
    if (t.ratio == null || t.ratio >= LTV_CAC_FLOOR) continue;
    if (!worst || t.ratio < worst.ratio) worst = { tranche: t.tranche, ratio: t.ratio };
  }
  return worst;
}
