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

/**
 * Full engine config - aligned with engine usage
 */
export interface ResourceGapEngineConfig {
  proficiency: ProficiencyConfig;
  skillTaxonomy: SkillTaxonomyConfig;
  timeToFill: TimeToFillConfig;
  costBand: CostBandConfig;
  hireVsContractThresholdMonths: number;
  secondaryGapRiskThreshold: number;
  // Back-compat aliases for older code paths
  taxonomy?: SkillTaxonomyConfig;
  costBands?: CostBandConfig;
  contractorThresholdMonths?: number;
  secondaryGapCoverageThreshold?: number;
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

const CANONICAL_DICTIONARY: CanonicalSkillEntry[] = [
  { canonicalId: "JavaScript", cluster: "frontend", aliases: ["js", "javascript"] },
  { canonicalId: "TypeScript", cluster: "frontend", aliases: ["ts", "typescript", "type-script"] },
  { canonicalId: "React", cluster: "frontend", aliases: ["reactjs", "react.js", "React"] },
  { canonicalId: "Node.js", cluster: "backend", aliases: ["node", "nodejs", "node.js"] },
  { canonicalId: "Python", cluster: "backend", aliases: ["py", "python"] },
  { canonicalId: "AWS", cluster: "cloud", aliases: ["aws", "amazon web services"] },
  { canonicalId: "Golang", cluster: "backend", aliases: ["go", "golang"] },
  { canonicalId: "Kubernetes", cluster: "cloud", aliases: ["k8s", "kubernetes"] },
  { canonicalId: "Docker", cluster: "cloud", aliases: ["docker"] },
  { canonicalId: "PostgreSQL", cluster: "data", aliases: ["postgres", "postgresql"] },
  { canonicalId: "Product Management", cluster: "product", aliases: ["pm", "product management", "product_management"] },
  { canonicalId: "Data Engineering", cluster: "data", aliases: ["data eng", "data engineering"] },
  { canonicalId: "Machine Learning", cluster: "data", aliases: ["ml", "machine learning"] },
];

export const DEFAULT_RESOURCE_GAP_CONFIG: ResourceGapEngineConfig = {
  proficiency: { entries: buildProficiencyEntries() },
  skillTaxonomy: {
    dictionary: CANONICAL_DICTIONARY,
    flagOriginalWhenUnmapped: true,
  },
  taxonomy: {
    dictionary: CANONICAL_DICTIONARY,
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
  costBand: {
    perSeniorityFTE: {
      junior: { min: 60_000, max: 90_000, currency: "USD" },
      mid: { min: 90_000, max: 130_000, currency: "USD" },
      senior: { min: 130_000, max: 180_000, currency: "USD" },
      staff: { min: 180_000, max: 250_000, currency: "USD" },
      principal: { min: 250_000, max: 350_000, currency: "USD" },
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
  hireVsContractThresholdMonths: 6,
  contractorThresholdMonths: 6,
  secondaryGapRiskThreshold: 0.75,
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
  node: "Node.js",
  "node.js": "Node.js",
  nodejs: "Node.js",
  aws: "AWS",
  "amazon web services": "AWS",
  go: "Golang",
  golang: "Golang",
  k8s: "Kubernetes",
  kubernetes: "Kubernetes",
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
    hireVsContractThresholdMonths: DEFAULT_RESOURCE_GAP_CONFIG.hireVsContractThresholdMonths,
    secondaryGapRiskThreshold: DEFAULT_RESOURCE_GAP_CONFIG.secondaryGapRiskThreshold,
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
  // Also check legacy dict
  if (DEFAULT_CANONICAL_SKILL_DICT[normalized]) {
    return DEFAULT_CANONICAL_SKILL_DICT[normalized];
  }
  return rawSkillId;
}

export function isUnmappedSkill(taxonomy: SkillTaxonomyConfig, rawSkillId: string): boolean {
  const normalized = rawSkillId.trim().toLowerCase();
  for (const entry of taxonomy.dictionary) {
    if (entry.canonicalId.toLowerCase() === normalized) return false;
    if (entry.aliases?.some((a) => a.toLowerCase() === normalized)) return false;
  }
  // Check legacy dict too
  if (DEFAULT_CANONICAL_SKILL_DICT[normalized]) return false;
  return true;
}
