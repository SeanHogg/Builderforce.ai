/**
 * Resource Gap Engine — configuration
 *
 * FR-2.2  proficiency weighting
 * FR-3.2  urgency / time-to-fill table
 * FR-1.4  canonical skill dictionary seed
 *         (heavy lists should come from the caller via param/context)
 */

import type { ProficiencyWeightEntry, SeniorityBand } from "./types.js";

export type Proficiency = 1 | 2 | 3 | 4 | 5;

export interface ProficiencyConfig {
  /**
   * Weighting entries keyed by (supply, required) → ratio.
   * Gap uses weighted supply: sum(availability * weight) per skill per quarter.
   *
   * Default: L5→L5 = 1.0, L3→L5 = 0.5, etc.
   * Supply ≥ required → 1.0, below → partial.
   */
  entries: ProficiencyWeightEntry[];
}

export interface CanonicalSkillEntry {
  canonicalId: string;
  cluster?: string;
  aliases?: string[];
}

export interface SkillTaxonomyConfig {
  dictionary: CanonicalSkillEntry[];
  /**
   * When true (default false), unrecognized skills are flagged but
   * still counted against gaps using original id.
   */
  flagOriginalWhenUnmapped?: boolean;
}

export interface TimeToFillConfig {
  /** Days per seniority band — configurable per role family in FR-3.2 */
  perSeniority: Record<SeniorityBand, number>;
  /** Optional override per team / family key */
  perFamily?: Record<string, number>;
}

export interface CostBandConfig {
  perSeniorityFTE: Record<SeniorityBand, { min: number; max: number; currency?: string }>;
}

export interface ResourceGapEngineConfig {
  proficiency: ProficiencyConfig;
  taxonomy: SkillTaxonomyConfig;
  timeToFill: TimeToFillConfig;
  costBands: CostBandConfig;
  /**
   * Demand duration threshold (months) below which contractor is preferred — FR-3.3
   * Default: 6.
   */
  contractorThresholdMonths: number;
  /**
   * Coverage threshold below which secondary-gap flag fires — FR-4.4 / AC-5
   * Default: 0.75 (i.e. source team coverage < 75% post-redeployment).
   */
  secondaryGapCoverageThreshold: number;
}

function buildProficiencyEntries(): ProficiencyWeightEntry[] {
  const entries: ProficiencyWeightEntry[] = [];
  for (let req = 1 as Proficiency; req <= 5; req = (req + 1) as Proficiency) {
    for (let sup = 1 as Proficiency; sup <= 5; sup = (sup + 1) as Proficiency) {
      let ratio: number;
      if (sup >= req) {
        ratio = 1;
      } else {
        const delta = req - sup;
        // Graduated partial supply: linear declining 0.75, 0.5, 0.25, 0
        if (delta === 1) ratio = 0.75;
        else if (delta === 2) ratio = 0.5;
        else if (delta === 3) ratio = 0.25;
        else ratio = 0;
      }
      entries.push({ supplyLevel: sup, requiredLevel: req, ratio });
    }
  }
  return entries;
}

/** Global static defaults — keep self-contained, no host side-effects */
export const DEFAULT_RESOURCE_GAP_CONFIG: ResourceGapEngineConfig = {
  proficiency: { entries: buildProficiencyEntries() },
  taxonomy: {
    dictionary: [
      { canonicalId: "typescript", aliases: ["ts", "type-script"] },
      { canonicalId: "react", aliases: ["reactjs", "react.js"] },
      { canonicalId: "nodejs", aliases: ["node", "node.js"] },
      { canonicalId: "python", aliases: ["py"] },
      { canonicalId: "aws", aliases: ["amazon web services"] },
      { canonicalId: "product_management", aliases: ["pm", "product management"] },
    ],
    flagOriginalWhenUnmapped: true,
  },
  timeToFill: {
    perSeniority: {
      junior: 30,
      mid: 45,
      senior: 60,
      staff: 90,
      principal: 120,
    },
  },
  costBands: {
    perSeniorityFTE: {
      junior: { min: 60_000, max: 90_000, currency: "USD" },
      mid: { min: 90_000, max: 130_000, currency: "USD" },
      senior: { min: 130_000, max: 180_000, currency: "USD" },
      staff: { min: 180_000, max: 250_000, currency: "USD" },
      principal: { min: 250_000, max: 350_000, currency: "USD" },
    },
  },
  contractorThresholdMonths: 6,
  secondaryGapCoverageThreshold: 0.75,
};

/**
 * Return effective availability ratio for a specific supply/required proficiency pair.
 *
 * Resolution order:
 *  1) Any explicit entry for exact (supplyLevel, requiredLevel) wins.
 *  2) Otherwise, monotonic partial-supply fallback based on delta.
 *  3) Supply absent → 0.
 */
export function getEffectiveRatio(
  proficiency: ProficiencyConfig | undefined,
  supplyLevel: Proficiency | undefined,
  requiredLevel: Proficiency,
): number {
  if (supplyLevel === undefined) return 0;
  const entries = proficiency?.entries ?? DEFAULT_RESOURCE_GAP_CONFIG.proficiency.entries;

  // Exact match — no dependence on iteration order of the entries list.
  const exact = entries.find(
    (e) => e.supplyLevel === supplyLevel && e.requiredLevel === requiredLevel,
  );
  if (exact) return exact.ratio;

  // Ordered fallback.
  if (supplyLevel >= requiredLevel) return 1;
  const delta = requiredLevel - supplyLevel;
  if (delta === 1) return 0.75;
  if (delta === 2) return 0.5;
  if (delta === 3) return 0.25;
  return 0;
}

/**
 * Canonical skill id from taxonomy + raw skill id.
 * Returns original id when not found and flagOriginalWhenUnmapped is true,
 * otherwise returns original id anyway (gap engine still operates on free-form).
 */
export function resolveCanonicalSkillId(
  taxonomy: SkillTaxonomyConfig,
  rawSkillId: string,
): string {
  const normalized = rawSkillId.trim().toLowerCase();
  for (const entry of taxonomy.dictionary) {
    if (entry.canonicalId.toLowerCase() === normalized) return entry.canonicalId;
    if (entry.aliases?.some((a) => a.toLowerCase() === normalized)) return entry.canonicalId;
  }
  return rawSkillId; // caller can still flag as unmapped
}

export function isUnmappedSkill(taxonomy: SkillTaxonomyConfig, rawSkillId: string): boolean {
  const normalized = rawSkillId.trim().toLowerCase();
  for (const entry of taxonomy.dictionary) {
    if (entry.canonicalId.toLowerCase() === normalized) return false;
    if (entry.aliases?.some((a) => a.toLowerCase() === normalized)) return false;
  }
  return true;
}
