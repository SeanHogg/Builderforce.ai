/**
 * @file configuration.ts
 * @module @builderforce/resource-gap-engine
 * @description Default configuration constants: canonical skill dictionary, proficiency weightings, cost ranges, time-to-fill estimates, thresholds.
 * This layer is pure data; no logic or side effects.
 */

import type {
  RGConfiguration,
  WeightingEntry,
  CurrencyRange,
  RGSkill,
  RGQuarter,
} from "./types.js";

/**
 * Default canonical skill dictionary (FR-1.4)
 * Maps common aliases to a canonical name (lowercase) for normalization.
 */
export const DEFAULT_CANONICAL_SKILL_DICT: Readonly<Record<string, string>> = {
  // Programming
  "javascript": "JavaScript",
  "ts": "TypeScript",
  "tsx": "TypeScript JSX",
  "js": "JavaScript",
  "py": "Python",
  "python": "Python",
  "go": "Go",
  "rust": "Rust",
  "java": "Java",
  "c++": "C++",
  "csharp": "C#",
  "c#": "C#",
  "php": "PHP",
  "ruby": "Ruby",
  "swift": "Swift",
  "kotlin": "Kotlin",
  "scala": "Scala",
  "tsql": "T-SQL",
  "sql": "SQL",

  // Frontend / UI
  "react": "React",
  "angular": "Angular",
  "vue": "Vue",
  "next": "Next.js",
  "nuxt": "Nuxt.js",
  "svelte": "Svelte",

  // Backend / Infrastructure
  "graphql": "GraphQL",
  "rest": "REST",
  "grpc": "gRPC",
  "kubernetes": "Kubernetes",
  "docker": "Docker",
  "aws": "AWS",
  "azure": "Azure",
  "gcp": "GCP",
  "terraform": "Terraform",
  "ansible": "Ansible",
  "ci/cd": "CI/CD",
  "devops": "DevOps",

  // Data / Analytics
  "db": "Database",
  "database": "Database",
  "sql": "SQL",
  "analytics": "Analytics",
  "pandas": "pandas",
  "hadoop": "Hadoop",
  "spark": "Spark",
  "postgres": "PostgreSQL",
  "mysql": "MySQL",
  "mongodb": "MongoDB",

  // QA / Testing
  "testing": "Testing",
  "junit": "JUnit",
  "pytest": "pytest",
  "jest": "Jest",
  "cypress": "Cypress",
  "selenium": "Selenium",

  // Engineering practices
  "agile": "Agile",
  "scrum": "Scrum",
  "kanban": "Kanban",
  "tdd": "Test-Driven Development",
  "ci": "CI/CD",
  "code-review": "Code Review",

  // Cloud / DevOps (overlap)
  "aws": "AWS",
  "azure": "Azure",
  "gcp": "GCP",
  "docker": "Docker",
  "k8s": "Kubernetes",
  "kubernetes": "Kubernetes",

  // General
  "communication": "Communication",
  "leadership": "Leadership",
  "mentorship": "Mentorship",
  "problem-solving": "Problem Solving",
} as const;

/**
 * Default proficiency weighting table (FR-2.2)
 * For a given required level (lev_req) and available level (lev_sup), compute effective coverage.
 * Example: if we need level 4 and we have level 3 with a 0.6 ratio, effective supply = 3 * 0.6 = 1.8 FTE.
 */
export const DEFAULT_PROFICIENCY_WEIGHTING: ReadonlyArray<WeightingEntry> = [
  // Level 4 required (supplies at or above minimum)
  { minimumSupplyProficiency: 3, maxEffectiveProficiency: 4, effectiveRatio: 0.8 },
  { minimumSupplyProficiency: 4, maxEffectiveProficiency: 5, effectiveRatio: 1.0 },
  // Level 5 required (supplies at or above minimum)
  { minimumSupplyProficiency: 4, maxEffectiveProficiency: 4, effectiveRatio: 0.8 },
  { minimumSupplyProficiency: 5, maxEffectiveProficiency: 5, effectiveRatio: 1.0 },
] as const;

/**
 * Default cost ranges per role family (FR-3.1)
 * Ranges are before-tax. Low-bound is 40% hourly to capture FTE ~8h/day × 2000h/yr ≈ 16k USD.
 */
export const DEFAULT_COST_RANGES: Readonly<Record<string, CurrencyRange>> = {
  "Senior-Engineer:FullTime": {
    currency: "USD",
    minimumCents: 160000,
    maximumCents: 260000,
  },
  "Mid-Engineer:FullTime": {
    currency: "USD",
    minimumCents: 90000,
    maximumCents: 150000,
  },
  "Junior-Engineer:FullTime": {
    currency: "USD",
    minimumCents: 55000,
    maximumCents: 85000,
  },
  "Staff-Engineer:FullTime": {
    currency: "USD",
    minimumCents: 230000,
    maximumCents: 350000,
  },
  "Principal-Engineer:FullTime": {
    currency: "USD",
    minimumCents: 350000,
    maximumCents: 550000,
  },
  "Distinguished-Engineer:FullTime": {
    currency: "USD",
    minimumCents: 550000,
    maximumCents: 900000,
  },
  "Lead-Engineer:FullTime": {
    currency: "USD",
    minimumCents: 180000,
    maximumCents: 280000,
  },
  "Tech-lead-over-fullstack": {
    currency: "USD",
    minimumCents: 170000,
    maximumCents: 270000,
  },
  // FTE roles where the role family is explicitly "FullTime" (e.g., Hire FTE vs Contract)
  "FullTime": {
    currency: "USD",
    minimumCents: 55000,
    maximumCents: 900000,
  },
  "Contractor:FullTime-equivalent": {
    currency: "USD",
    minimumCents: 40000,
    maximumCents: 80000,
  },
} as const;

/**
 * Default time-to-fill estimates (FR-3.2)
 * Weeks to fill a role, when external. Use 2 weeks to 20 weeks depending on seniority.
 */
export const DEFAULT_TIME_TO_FILL_WEEKS: Readonly<Record<string, number>> = {
  "Distinguished-Engineer:FullTime": 20,
  "Principal-Engineer:FullTime": 18,
  "Senior-Engineer:FullTime": 16,
  "Lead-Engineer:FullTime": 16,
  "Staff-Engineer:FullTime": 16,
  "Mid-Engineer:FullTime": 10,
  "Junior-Engineer:FullTime": 8,
  "Tech-lead-over-fullstack": 16,
  "FullTime": 10, // fallback
  "Contractor:FullTime-equivalent": 6, // fast-tracked
} as const;

/**
 * Default configuration (FR-1.4, FR-2.2, FR-3.2, FR-3.3, FR-4.4)
 */
export const DEFAULT_CONFIGURATION: Partial<RGConfiguration> = {
  canonicalSkillDictionary: DEFAULT_CANONICAL_SKILL_DICT,
  proficiencyWeighting: DEFAULT_PROFICIENCY_WEIGHTING,
  defaultCostRanges: DEFAULT_COST_RANGES,
  timeToFillEstimates: DEFAULT_TIME_TO_FILL_WEEKS,
  hireVsContractThresholdMonths: 6, // hire vs contract threshold (FR-3.3)
  secondaryGapRiskThreshold: 0.75, // risk flag >75% coverage (FR-4.4, AC-5)
  fullCoverageProficiencyRatio: 1.0, // effective supply at or above against requirement is full FTE
};

/**
 * Build a full configuration object from defaults (deep merge).
 */
export function buildDefaultConfiguration(): RGConfiguration {
  return {
    canonicalSkillDictionary: DEFAULT_CANONICAL_SKILL_DICT,
    proficiencyWeighting: DEFAULT_PROFICIENCY_WEIGHTING,
    defaultCostRanges: DEFAULT_COST_RANGES,
    timeToFillEstimates: DEFAULT_TIME_TO_FILL_WEEKS,
    hireVsContractThresholdMonths: 6,
    secondaryGapRiskThreshold: 0.75,
    fullCoverageProficiencyRatio: 1.0,
  };
}