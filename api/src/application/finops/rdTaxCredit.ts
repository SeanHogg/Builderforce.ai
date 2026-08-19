/**
 * R&D Tax Credits — a QRE-style (Qualified Research Expenditure) rollup framed for
 * the US R&D credit (Form 6765). Jurisdiction-agnostic numbers, US labelling.
 *
 * We do NOT collect anything new. A workspace defines which investment categories
 * (and optionally which action types) count as Qualified Research, plus a blended
 * labor rate; we then DERIVE:
 *   - qualified hours     — effort-in-TIME for qualified categories (allocation lens),
 *   - qualified labor $   — see below,
 *   - qualified AI/cloud $ — attributed llm_usage_log spend on qualified categories
 *                            (the "supplies / cloud compute" QRE leg),
 *   - qualified base $    — labor + AI spend (the credit base before the % rate).
 *
 * ── THE WAGE LEG IS MEASURED WHERE IT CAN BE (AIIMP-5) ──────────────────────
 * It used to be `qualifiedHours × oneBlendedRate` and nothing else: one rate for
 * an intern and a principal, applied to hours derived from ticket open/close
 * timestamps. Both halves of that are now real where the tenant has supplied the
 * data — the allocation lens prices effort at each member's OWN modelled rate
 * (`member_profiles.cost_rate_usd_cents`) over REAL logged time (`time_entries`)
 * — and the blended rate survives only as the fallback for effort whose owner has
 * no rate on file.
 *
 * The report SAYS which it used. `laborBasis` names the mix and `measuredEffortPct`
 * gives the share of hours that came from recorded time, because a credit base
 * built from timesheets and salary bands and one built from two estimates print
 * the same number and are not the same evidence.
 *
 * Reuses {@link computeAllocationInsights} (effort hours + per-category cost +
 * per-category labour) so there is exactly one effort/cost engine.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { computeAllocationInsights } from '../insights/allocationInsights';
import { allocationCategoryLabel, normalizeAllocationCategory } from '../llm/allocationCategories';
import { rdTaxCreditConfig } from '../../infrastructure/database/schema';

/** Built-in default QRE definition when a tenant has not configured one. */
export const DEFAULT_QUALIFIED_CATEGORIES = ['innovation', 'tech_debt'];
export const DEFAULT_BLENDED_LABOR_RATE_USD = 95;

export interface RdTaxCreditConfig {
  qualifiedCategories: string[];
  blendedLaborRateUsd: number;
  qualifiedActionTypes: string[];
}

export interface RdCategoryLine {
  category: string;
  label: string;
  hours: number;
  /** Measured labour where member rates exist, blended-rate estimate for the rest. */
  laborUsd: number;
  /** Attributed AI/cloud spend for this category over the window. */
  aiSpendUsd: number;
  qualified: boolean;
}

/**
 * How the wage leg was arrived at.
 *   'measured'  — every qualified hour was priced at a member's own modelled rate.
 *   'mixed'     — some was; the remainder used the blended fallback.
 *   'estimated' — no member rates at all; the whole leg is the blended rate.
 */
export type LaborBasis = 'measured' | 'mixed' | 'estimated';

export interface RdTaxCreditReport {
  period: string;
  windowDays: number;
  qualifiedHours: number;
  blendedRate: number;
  qualifiedLaborUsd: number;
  qualifiedAiSpendUsd: number;
  qualifiedBaseUsd: number;
  qualifiedCategories: string[];
  byCategory: RdCategoryLine[];
  /** Which evidence the wage leg rests on — never inferred by the reader. */
  laborBasis: LaborBasis;
  /** Of the qualified labour dollars, how many came from real member rates. */
  measuredLaborUsd: number;
  /** Of the qualified HOURS, the share recorded in timesheets rather than estimated. */
  measuredEffortPct: number;
}

/** Fetch the tenant's QRE config, or the built-in default when none is stored. */
export async function getRdTaxCreditConfig(db: Db, tenantId: number): Promise<RdTaxCreditConfig> {
  const [row] = await db
    .select({
      qualifiedCategories: rdTaxCreditConfig.qualifiedCategories,
      blendedLaborRateUsd: rdTaxCreditConfig.blendedLaborRateUsd,
      qualifiedActionTypes: rdTaxCreditConfig.qualifiedActionTypes,
    })
    .from(rdTaxCreditConfig)
    .where(eq(rdTaxCreditConfig.tenantId, tenantId))
    .limit(1);
  if (!row) {
    return {
      qualifiedCategories: [...DEFAULT_QUALIFIED_CATEGORIES],
      blendedLaborRateUsd: DEFAULT_BLENDED_LABOR_RATE_USD,
      qualifiedActionTypes: [],
    };
  }
  return {
    qualifiedCategories: Array.isArray(row.qualifiedCategories) && row.qualifiedCategories.length
      ? row.qualifiedCategories
      : [...DEFAULT_QUALIFIED_CATEGORIES],
    blendedLaborRateUsd: typeof row.blendedLaborRateUsd === 'number' ? row.blendedLaborRateUsd : DEFAULT_BLENDED_LABOR_RATE_USD,
    qualifiedActionTypes: Array.isArray(row.qualifiedActionTypes) ? row.qualifiedActionTypes : [],
  };
}

/**
 * Compute the QRE report for a tenant over the trailing `days` window. `period` is
 * the 'YYYY-MM' label carried through for reporting; the math is over the window.
 */
export async function computeRdTaxCredit(
  db: Db,
  tenantId: number,
  period: string,
  days: number,
): Promise<RdTaxCreditReport> {
  const config = await getRdTaxCreditConfig(db, tenantId);
  const qualifiedSet = new Set(config.qualifiedCategories.map((c) => normalizeAllocationCategory(c)));
  const rate = config.blendedLaborRateUsd > 0 ? config.blendedLaborRateUsd : DEFAULT_BLENDED_LABOR_RATE_USD;

  const allocation = await computeAllocationInsights(db, tenantId, days, Date.now());

  let qualifiedHours = 0;
  let qualifiedAiSpendUsd = 0;
  let qualifiedLaborUsd = 0;
  let measuredLaborUsd = 0;

  const byCategory: RdCategoryLine[] = allocation.byCategory.map((b) => {
    const qualified = qualifiedSet.has(b.category);
    // MEASURED dollars first: `b.laborUsd` is this category's effort priced at each
    // member's own rate, and is 0 only for effort whose owner has no rate on file.
    // The blended rate then covers exactly that residue — the hours the tenant has
    // no compensation data for — instead of overwriting the hours it does.
    const unratedHours = Math.max(0, b.hours - b.ratedHours);
    const laborUsd = b.laborUsd + unratedHours * rate;
    if (qualified) {
      qualifiedHours += b.hours;
      qualifiedAiSpendUsd += b.costUsd;
      qualifiedLaborUsd += laborUsd;
      measuredLaborUsd += b.laborUsd;
    }
    return {
      category: b.category,
      label: allocationCategoryLabel(b.category),
      hours: b.hours,
      laborUsd,
      aiSpendUsd: b.costUsd,
      qualified,
    };
  });

  const qualifiedBaseUsd = qualifiedLaborUsd + qualifiedAiSpendUsd;
  const laborBasis: LaborBasis = measuredLaborUsd <= 0
    ? 'estimated'
    : measuredLaborUsd >= qualifiedLaborUsd - 0.005 ? 'measured' : 'mixed';

  return {
    period,
    windowDays: days,
    qualifiedHours,
    blendedRate: rate,
    qualifiedLaborUsd,
    qualifiedAiSpendUsd,
    qualifiedBaseUsd,
    qualifiedCategories: [...qualifiedSet],
    byCategory,
    laborBasis,
    measuredLaborUsd,
    measuredEffortPct: allocation.totals.measuredEffortPct,
  };
}
