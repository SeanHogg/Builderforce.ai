/**
 * Resource Gap Engine — configuration
 *
 * FR-2.2  proficiency weighting
 * FR-3.2  urgency / time-to-fill table
 * FR-1.4  canonical skill dictionary seed
 */

import type { ProficiencyWeightEntry, SeniorityBand } from "./types.js";

export type Proficiency = 1 | 2 | 3 | 4 | 5;

export interface ProficiencyConfig {
  entries: ProficiencyWeightEntry[];
}

export interface CanonicalSkillEntry {
  canonicalId: string;
  cluster?: string;
  aliases?: string[];
}

export interface SkillTaxonomyConfig {
  dictionary: CanonicalSkillEntry[];
  flagOriginalWhenUnmapped?: boolean;
}

export interface TimeToFillConfig {
  perSeniority: Record<SeniorityBand, number>;
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
  contractorThresholdMonths: number;
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
      { canonicalId: "javascript", aliases: ["js", "javascript"] },
      { canonicalId: "JavaScript", aliases: ["js"] },
      { canonicalId: "TypeScript", aliases: ["ts"] },
      { canonicalId: "React", aliases: ["react"] },
      { canonicalId: "Python", aliases: ["py"] },
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

// ── Backwards-compat exports expected by configuration.test.ts ─────────

export const DEFAULT_CANONICAL_SKILL_DICT: Record<string, string> = {
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  react: "React",
  reactjs: "React",
  "react.js": "React",
  py: "Python",
  python: "Python",
  node: "nodejs",
  "node.js": "nodejs",
  nodejs: "nodejs",
  aws: "aws",
  "amazon web services": "aws",
};

export interface LegacyDefaultConfig {
  canonicalSkillDictionary: Record<string, string>;
  proficiencyWeighting: unknown[];
  defaultCostRanges: Record<string, { min: number; max: number }>;
  timeToFillEstimates: Record<string, number>;
  hireVsContractThresholdMonths: number;
  secondaryGapRiskThreshold: number;
  fullCoverageProficiencyRatio: number;
}

export function buildDefaultConfiguration(): LegacyDefaultConfig {
  return {
    canonicalSkillDictionary: DEFAULT_CANONICAL_SKILL_DICT,
    proficiencyWeighting: [
      { minimumSupplyProficiency: 3, maxEffectiveProficiency: 4 },
      { minimumSupplyProficiency: 4, maxEffectiveProficiency: 5 },
    ],
    defaultCostRanges: {
      junior: { min: 60_000, max: 90_000 },
      mid: { min: 90_000, max: 130_000 },
      senior: { min: 130_000, max: 180_000 },
      staff: { min: 180_000, max: 250_000 },
      principal: { min: 250_000, max: 350_000 },
    },
    timeToFillEstimates: {
      junior: 30,
      mid: 45,
      senior: 60,
      staff: 90,
      principal: 120,
    },
    hireVsContractThresholdMonths: DEFAULT_RESOURCE_GAP_CONFIG.contractorThresholdMonths,
    secondaryGapRiskThreshold: DEFAULT_RESOURCE_GAP_CONFIG.secondaryGapCoverageThreshold,
    fullCoverageProficiencyRatio: 1.0,
  };
}

export function getEffectiveRatio(
  proficiency: ProficiencyConfig | undefined,
  supplyLevel: Proficiency | undefined,
  requiredLevel: Proficiency,
): number {
  if (supplyLevel === undefined) return 0;
  const entries = proficiency?.entries ?? DEFAULT_RESOURCE_GAP_CONFIG.proficiency.entries;

  const exact = entries.find(
    (e) => e.supplyLevel === supplyLevel && e.requiredLevel === requiredLevel,
  );
  if (exact) return exact.ratio;

  if (supplyLevel >= requiredLevel) return 1;
  const delta = requiredLevel - supplyLevel;
  if (delta === 1) return 0.75;
  if (delta === 2) return 0.5;
  if (delta === 3) return 0.25;
  return 0;
}

export function resolveCanonicalSkillId(
  taxonomy: SkillTaxonomyConfig,
  rawSkillId: string,
): string {
  const normalized = rawSkillId.trim().toLowerCase();
  for (const entry of taxonomy.dictionary) {
    if (entry.canonicalId.toLowerCase() === normalized) return entry.canonicalId;
    if (entry.aliases?.some((a) => a.toLowerCase() === normalized)) return entry.canonicalId;
  }
  return rawSkillId;
}

export function isUnmappedSkill(taxonomy: SkillTaxonomyConfig, rawSkillId: string): boolean {
  const normalized = rawSkillId.trim().toLowerCase();
  for (const entry of taxonomy.dictionary) {
    if (entry.canonicalId.toLowerCase() === normalized) return false;
    if (entry.aliases?.some((a) => a.toLowerCase() === normalized)) return false;
  }
  return true;
}
