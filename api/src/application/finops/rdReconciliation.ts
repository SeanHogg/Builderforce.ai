/**
 * R&D reconciliation (EMP — reconcile the two R&D-financial surfaces).
 *
 * The platform has TWO R&D-spend surfaces that were never cross-checked:
 *   1. DERIVED — {@link computeRdTaxCredit}: a QRE-style credit base derived for
 *      free from the allocation lens (qualified effort-hours × blended labor rate)
 *      plus attributed LLM/cloud spend. It moves automatically with the work.
 *   2. REPORTED — {@link computeRdFinancials} over the manual quarterly fact tables
 *      (0238/0239): dollars a finance user enters per (fy, quarter, category).
 *
 * When both exist they should roughly agree; when they diverge, that divergence is
 * itself the signal (a mis-scoped QRE config, or stale/missing manual entry). This
 * module puts them side-by-side for a fiscal year with a variance + a flag, so the
 * two surfaces reconcile rather than silently drift. Reuses both existing engines —
 * no new collection, no third number.
 */

import type { Db } from '../../infrastructure/database/connection';
import { computeRdTaxCredit } from './rdTaxCredit';
import { computeRdFinancials, type QuarterFinancials } from '../insights/rdFinancialsInsights';

const DAY_MS = 86_400_000;
/** |variance| within this band → the two surfaces are considered aligned. */
export const RECON_ALIGN_PCT = 15;

export type ReconFlag = 'aligned' | 'derived_higher' | 'reported_higher' | 'no_reported';

export interface RdReconciliation {
  fiscalYear: number;
  windowDays: number;
  derived: {
    qualifiedHours: number;
    blendedRate: number;
    laborUsd: number;
    aiSpendUsd: number;
    baseUsd: number;
  };
  reported: {
    actualUsd: number;
    planUsd: number;
    revenueUsd: number | null;
    rdToRevenuePct: number | null;
  };
  variance: {
    /** derived.baseUsd − reported.actualUsd (positive = derived exceeds reported). */
    absUsd: number;
    /** Variance as a % of reported actual (null when nothing reported). */
    pct: number | null;
    flag: ReconFlag;
  };
  /** Reported quarters (for the drill-down context table). */
  quarters: QuarterFinancials[];
}

/** Pure: classify the variance between derived base and reported actual. */
export function reconFlag(derivedBaseUsd: number, reportedActualUsd: number): { pct: number | null; flag: ReconFlag } {
  if (reportedActualUsd <= 0) return { pct: null, flag: 'no_reported' };
  const pct = ((derivedBaseUsd - reportedActualUsd) / reportedActualUsd) * 100;
  if (Math.abs(pct) <= RECON_ALIGN_PCT) return { pct, flag: 'aligned' };
  return { pct, flag: pct > 0 ? 'derived_higher' : 'reported_higher' };
}

/**
 * Reconcile derived vs reported R&D spend for a fiscal year. The derived side is
 * computed over the elapsed FY window (Jan 1 → min(now, FY end)), since the QRE
 * derivation is a trailing-window rollup; the reported side sums the manual
 * quarterly facts for the year.
 */
export async function reconcileRd(db: Db, tenantId: number, fiscalYear: number): Promise<RdReconciliation> {
  const now = Date.now();
  const fyStart = Date.UTC(fiscalYear, 0, 1);
  const fyEnd = Date.UTC(fiscalYear + 1, 0, 1);
  const windowEnd = Math.min(now, fyEnd);
  const windowDays = Math.max(1, Math.min(366, Math.floor((windowEnd - fyStart) / DAY_MS)));
  const period = `${fiscalYear}-01`;

  const [credit, financials] = await Promise.all([
    computeRdTaxCredit(db, tenantId, period, windowDays),
    computeRdFinancials(db, tenantId, fiscalYear),
  ]);

  const actualUsd = financials.quarters.reduce((a, q) => a + q.totalActualUsd, 0);
  const planUsd = financials.quarters.reduce((a, q) => a + q.totalPlanUsd, 0);
  const revenueUsd = financials.quarters.reduce<number | null>(
    (a, q) => (q.revenueUsd != null ? (a ?? 0) + q.revenueUsd : a),
    null,
  );
  const rdToRevenuePct = revenueUsd && revenueUsd > 0 ? (actualUsd / revenueUsd) * 100 : null;

  const { pct, flag } = reconFlag(credit.qualifiedBaseUsd, actualUsd);

  return {
    fiscalYear,
    windowDays,
    derived: {
      qualifiedHours: credit.qualifiedHours,
      blendedRate: credit.blendedRate,
      laborUsd: credit.qualifiedLaborUsd,
      aiSpendUsd: credit.qualifiedAiSpendUsd,
      baseUsd: credit.qualifiedBaseUsd,
    },
    reported: { actualUsd, planUsd, revenueUsd, rdToRevenuePct },
    variance: { absUsd: credit.qualifiedBaseUsd - actualUsd, pct, flag },
    quarters: financials.quarters,
  };
}
