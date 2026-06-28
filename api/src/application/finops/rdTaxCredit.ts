/**
 * R&D Tax Credits — a QRE-style (Qualified Research Expenditure) rollup framed for
 * the US R&D credit (Form 6765). Jurisdiction-agnostic numbers, US labelling.
 *
 * We do NOT collect anything new. A workspace defines which investment categories
 * (and optionally which action types) count as Qualified Research, plus a blended
 * labor rate; we then DERIVE:
 *   - qualified hours     — effort-in-TIME for qualified categories (allocation lens),
 *   - qualified labor $   — qualified hours × blended rate (the wage QRE proxy),
 *   - qualified AI/cloud $ — attributed llm_usage_log spend on qualified categories
 *                            (the "supplies / cloud compute" QRE leg),
 *   - qualified base $    — labor + AI spend (the credit base before the % rate).
 *
 * Reuses {@link computeAllocationInsights} (effort hours + per-category cost) so
 * there is exactly one effort/cost engine.
 */

import { eq } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { computeAllocationInsights } from '../insights/allocationInsights';
import { allocationCategoryLabel, normalizeAllocationCategory } from '../llm/allocationCategories';
import { rdTaxCreditConfig } from './finopsTables';

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
  laborUsd: number;
  /** Attributed AI/cloud spend for this category over the window. */
  aiSpendUsd: number;
  qualified: boolean;
}

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
  const byCategory: RdCategoryLine[] = allocation.byCategory.map((b) => {
    const qualified = qualifiedSet.has(b.category);
    const laborUsd = b.hours * rate;
    if (qualified) {
      qualifiedHours += b.hours;
      qualifiedAiSpendUsd += b.costUsd;
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

  const qualifiedLaborUsd = qualifiedHours * rate;
  const qualifiedBaseUsd = qualifiedLaborUsd + qualifiedAiSpendUsd;

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
  };
}
