/**
 * LENS — "R&D Financials" (the board-deck Investment slide): disaggregated
 * quarterly R&D spend that financeInsights (LLM-only) and allocationInsights
 * (effort-time) don't capture. Reads the new quarterly fact tables (migration
 * 0239) and produces, per quarter:
 *
 *   - spend by category (actual vs plan + variance %),
 *   - total actual / total plan, growth vs prior quarter,
 *   - revenue + Total-R&D$/Revenue ratio,
 *   - FTE allocation by category (Historical Investment Allocation).
 *
 * Aggregation is pure ({@link summarizeRdFinancials}) over already-fetched rows so
 * it is unit-testable without a DB; {@link computeRdFinancials} does the I/O.
 */

import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { rdFinancialsQuarterly, rdRevenueQuarterly, rdFteAllocationQuarterly } from '../../infrastructure/database/schema';

export interface FinancialRow { quarter: number; category: string; actualUsd: number; planUsd: number; }
export interface RevenueRow { quarter: number; revenueUsd: number; }
export interface FteRow { quarter: number; category: string; fte: number; }

export interface CategorySpend { category: string; actualUsd: number; planUsd: number; actualVsPlanPct: number | null; }
export interface QuarterFinancials {
  quarter: number;
  byCategory: CategorySpend[];
  totalActualUsd: number;
  totalPlanUsd: number;
  growthVsPriorQPct: number | null;
  revenueUsd: number | null;
  rdToRevenuePct: number | null;
  fteByCategory: Array<{ category: string; fte: number }>;
}
export interface RdFinancialsInsights {
  fiscalYear: number;
  quarters: QuarterFinancials[];
}

/**
 * Pure: assemble the R&D financials lens for a fiscal year from already-fetched
 * rows. Quarters are emitted in ascending order; growth is vs the immediately
 * preceding emitted quarter (null for the first).
 */
export function summarizeRdFinancials(
  fiscalYear: number,
  financials: FinancialRow[],
  revenue: RevenueRow[],
  fte: FteRow[],
): RdFinancialsInsights {
  const revByQuarter = new Map<number, number>();
  for (const r of revenue) revByQuarter.set(r.quarter, r.revenueUsd);

  const fteByQuarter = new Map<number, Array<{ category: string; fte: number }>>();
  for (const f of fte) {
    const list = fteByQuarter.get(f.quarter) ?? [];
    list.push({ category: f.category, fte: f.fte });
    fteByQuarter.set(f.quarter, list);
  }

  const finByQuarter = new Map<number, FinancialRow[]>();
  for (const f of financials) {
    const list = finByQuarter.get(f.quarter) ?? [];
    list.push(f);
    finByQuarter.set(f.quarter, list);
  }

  const quarters = Array.from(new Set([
    ...finByQuarter.keys(), ...revByQuarter.keys(), ...fteByQuarter.keys(),
  ])).sort((a, b) => a - b);

  const out: QuarterFinancials[] = [];
  let priorTotal: number | null = null;
  for (const q of quarters) {
    const rows = finByQuarter.get(q) ?? [];
    const byCategory: CategorySpend[] = rows.map((r) => ({
      category: r.category,
      actualUsd: r.actualUsd,
      planUsd: r.planUsd,
      actualVsPlanPct: r.planUsd > 0 ? (r.actualUsd / r.planUsd) * 100 : null,
    }));
    const totalActualUsd = rows.reduce((a, r) => a + r.actualUsd, 0);
    const totalPlanUsd = rows.reduce((a, r) => a + r.planUsd, 0);
    const revenueUsd = revByQuarter.has(q) ? revByQuarter.get(q)! : null;
    out.push({
      quarter: q,
      byCategory,
      totalActualUsd,
      totalPlanUsd,
      growthVsPriorQPct: priorTotal != null && priorTotal > 0 ? ((totalActualUsd - priorTotal) / priorTotal) * 100 : null,
      revenueUsd,
      rdToRevenuePct: revenueUsd && revenueUsd > 0 ? (totalActualUsd / revenueUsd) * 100 : null,
      fteByCategory: fteByQuarter.get(q) ?? [],
    });
    priorTotal = totalActualUsd;
  }

  return { fiscalYear, quarters: out };
}

/** I/O: fetch the fiscal year's rows and assemble the lens. */
export async function computeRdFinancials(db: Db, tenantId: number, fiscalYear: number): Promise<RdFinancialsInsights> {
  const [financials, revenue, fte] = await Promise.all([
    db.select({ quarter: rdFinancialsQuarterly.quarter, category: rdFinancialsQuarterly.category, actualUsd: rdFinancialsQuarterly.actualUsd, planUsd: rdFinancialsQuarterly.planUsd })
      .from(rdFinancialsQuarterly)
      .where(and(eq(rdFinancialsQuarterly.tenantId, tenantId), eq(rdFinancialsQuarterly.fiscalYear, fiscalYear))) as Promise<FinancialRow[]>,
    db.select({ quarter: rdRevenueQuarterly.quarter, revenueUsd: rdRevenueQuarterly.revenueUsd })
      .from(rdRevenueQuarterly)
      .where(and(eq(rdRevenueQuarterly.tenantId, tenantId), eq(rdRevenueQuarterly.fiscalYear, fiscalYear))) as Promise<RevenueRow[]>,
    db.select({ quarter: rdFteAllocationQuarterly.quarter, category: rdFteAllocationQuarterly.category, fte: rdFteAllocationQuarterly.fte })
      .from(rdFteAllocationQuarterly)
      .where(and(eq(rdFteAllocationQuarterly.tenantId, tenantId), eq(rdFteAllocationQuarterly.fiscalYear, fiscalYear))) as Promise<FteRow[]>,
  ]);

  return summarizeRdFinancials(fiscalYear, financials, revenue, fte);
}
