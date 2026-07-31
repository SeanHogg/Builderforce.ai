/**
 * Default configuration constants for Resource Gap Engine
 * Pure data layer — no side-effects
 */

import type {
  RGConfiguration,
  RGProficiencyWeightingEntry,
  RGCurrencyRange,
} from "./types.js";

// ---------------------------------------------------------------------------
// FR-1.4: canonical skill dictionary
// Maps alias (lowercase-normalized) → canonical display name
// ---------------------------------------------------------------------------

export const DEFAULT_CANONICAL_SKILL_DICT: Readonly<Record<string, string>> = {
  // Programming languages
  javascript: "JavaScript",
  js: "JavaScript",
  typescript: "TypeScript",
  ts: "TypeScript",
  tsx: "TypeScript",
  python: "Python",
  py: "Python",
  go: "Go",
  golang: "Go",
  rust: "Rust",
  java: "Java",
  "c++": "C++",
  cpp: "C++",
  csharp: "C#",
  "c#": "C#",
  php: "PHP",
  ruby: "Ruby",
  swift: "Swift",
  kotlin: "Kotlin",
  scala: "Scala",
  sql: "SQL",
  tsql: "SQL",

  // Frontend / UI
  react: "React",
  angular: "Angular",
  vue: "Vue",
  nextjs: "Next.js",
  next: "Next.js",
  nuxt: "Nuxt.js",
  svelte: "Svelte",

  // Backend / infra
  graphql: "GraphQL",
  rest: "REST",
  grpc: "gRPC",
  kubernetes: "Kubernetes",
  k8s: "Kubernetes",
  docker: "Docker",
  aws: "AWS",
  azure: "Azure",
  gcp: "GCP",

  // Infra as code / DevOps
  terraform: "Terraform",
  ansible: "Ansible",
  "ci/cd": "CI/CD",
  ci: "CI/CD",
  devops: "DevOps",

  // Data / analytics
  database: "Database",
  db: "Database",
  analytics: "Analytics",
  pandas: "Pandas",
  hadoop: "Hadoop",
  spark: "Spark",
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  mongodb: "MongoDB",

  // QA / testing
  testing: "Testing",
  junit: "JUnit",
  pytest: "Pytest",
  jest: "Jest",
  cypress: "Cypress",
  selenium: "Selenium",

  // Engineering practices
  agile: "Agile",
  scrum: "Scrum",
  kanban: "Kanban",
  "test-driven development": "TDD",
  tdd: "TDD",
  "code review": "Code Review",
  "code-review": "Code Review",

  // Soft skills
  communication: "Communication",
  leadership: "Leadership",
  mentorship: "Mentorship",
  "problem solving": "Problem Solving",
  "problem-solving": "Problem Solving",
} as const;

// ---------------------------------------------------------------------------
// FR-2.2: proficiency weighting table
// Given a required level (minProf), and a supply level (empProf), how much
// of the supplier's availability counts? Rules are evaluated top-down.
// ---------------------------------------------------------------------------

export const DEFAULT_PROFICIENCY_WEIGHTING: ReadonlyArray<RGProficiencyWeightingEntry> = [
  // When only level-1 is required, any level covers fully
  { minSupplyLevel: 1, forMinRequiredLevel: 1, forMaxRequiredLevel: 1, effectiveRatio: 1 },
  // Level 2 required
  { minSupplyLevel: 2, forMinRequiredLevel: 2, forMaxRequiredLevel: 2, effectiveRatio: 1 },
  { minSupplyLevel: 1, forMinRequiredLevel: 2, forMaxRequiredLevel: 2, effectiveRatio: 0.4 },
  // Level 3 required
  { minSupplyLevel: 3, forMinRequiredLevel: 3, forMaxRequiredLevel: 3, effectiveRatio: 1 },
  { minSupplyLevel: 2, forMinRequiredLevel: 3, forMaxRequiredLevel: 3, effectiveRatio: 0.6 },
  { minSupplyLevel: 1, forMinRequiredLevel: 3, forMaxRequiredLevel: 3, effectiveRatio: 0.25 },
  // Level 4 required
  { minSupplyLevel: 4, forMinRequiredLevel: 4, forMaxRequiredLevel: 4, effectiveRatio: 1 },
  { minSupplyLevel: 3, forMinRequiredLevel: 4, forMaxRequiredLevel: 4, effectiveRatio: 0.7 },
  { minSupplyLevel: 2, forMinRequiredLevel: 4, forMaxRequiredLevel: 4, effectiveRatio: 0.35 },
  { minSupplyLevel: 1, forMinRequiredLevel: 4, forMaxRequiredLevel: 4, effectiveRatio: 0.15 },
  // Level 5 required
  { minSupplyLevel: 5, forMinRequiredLevel: 5, forMaxRequiredLevel: 5, effectiveRatio: 1 },
  { minSupplyLevel: 4, forMinRequiredLevel: 5, forMaxRequiredLevel: 5, effectiveRatio: 0.6 },
  { minSupplyLevel: 3, forMinRequiredLevel: 5, forMaxRequiredLevel: 5, effectiveRatio: 0.3 },
  { minSupplyLevel: 2, forMinRequiredLevel: 5, forMaxRequiredLevel: 5, effectiveRatio: 0.15 },
  { minSupplyLevel: 1, forMinRequiredLevel: 5, forMaxRequiredLevel: 5, effectiveRatio: 0.05 },
] as const;

// ---------------------------------------------------------------------------
// FR-3.1: cost ranges per role family
// ---------------------------------------------------------------------------

export const DEFAULT_COST_RANGES: Readonly<Record<string, RGCurrencyRange>> = {
  Entry: { currency: "USD", minAnnual: 55_000, maxAnnual: 85_000 },
  Junior: { currency: "USD", minAnnual: 55_000, maxAnnual: 85_000 },
  Mid: { currency: "USD", minAnnual: 90_000, maxAnnual: 150_000 },
  Senior: { currency: "USD", minAnnual: 130_000, maxAnnual: 200_000 },
  Lead: { currency: "USD", minAnnual: 160_000, maxAnnual: 260_000 },
  Staff: { currency: "USD", minAnnual: 200_000, maxAnnual: 320_000 },
  Principal: { currency: "USD", minAnnual: 280_000, maxAnnual: 450_000 },
  Distinguished: { currency: "USD", minAnnual: 400_000, maxAnnual: 700_000 },
  Contractor: { currency: "USD", minAnnual: 80_000, maxAnnual: 160_000 },
  Default: { currency: "USD", minAnnual: 90_000, maxAnnual: 180_000 },
} as const;

// ---------------------------------------------------------------------------
// FR-3.2: time-to-fill (weeks)
// ---------------------------------------------------------------------------

export const DEFAULT_TIME_TO_FILL_WEEKS: Readonly<Record<string, number>> = {
  Entry: 4,
  Junior: 6,
  Mid: 8,
  Senior: 12,
  Lead: 14,
  Staff: 16,
  Principal: 18,
  Distinguished: 20,
  Contractor: 4,
  Default: 10,
} as const;

// ---------------------------------------------------------------------------
// Skill cluster map (FR-2.3 segmentation helper)
// ---------------------------------------------------------------------------

export const DEFAULT_SKILL_CLUSTERS: Readonly<Record<string, string>> = {
  JavaScript: "Frontend",
  TypeScript: "Frontend",
  React: "Frontend",
  Angular: "Frontend",
  Vue: "Frontend",
  "Next.js": "Frontend",
  Python: "Backend",
  Java: "Backend",
  Go: "Backend",
  Rust: "Backend",
  "C#": "Backend",
  SQL: "Data",
  Database: "Data",
  PostgreSQL: "Data",
  MySQL: "Data",
  MongoDB: "Data",
  Spark: "Data",
  Hadoop: "Data",
  Analytics: "Data",
  Pandas: "Data",
  AWS: "Infra",
  Azure: "Infra",
  GCP: "Infra",
  Kubernetes: "Infra",
  Docker: "Infra",
  Terraform: "Infra",
  "CI/CD": "Infra",
  DevOps: "Infra",
  Testing: "QA",
  JUnit: "QA",
  Jest: "QA",
  Pytest: "QA",
  Cypress: "QA",
  Selenium: "QA",
  Leadership: "Management",
  Communication: "Management",
  Mentorship: "Management",
  Agile: "Process",
  Scrum: "Process",
  Kanban: "Process",
  TDD: "Process",
  "Code Review": "Process",
} as const;

// ---------------------------------------------------------------------------
// Full default config builder
// ---------------------------------------------------------------------------

export function buildDefaultConfiguration(): RGConfiguration {
  return {
    canonicalSkillDict: DEFAULT_CANONICAL_SKILL_DICT,
    proficiencyWeighting: DEFAULT_PROFICIENCY_WEIGHTING,
    defaultCostRanges: DEFAULT_COST_RANGES,
    timeToFillWeeks: DEFAULT_TIME_TO_FILL_WEEKS,
    hireVsContractThresholdMonths: 6,
    secondaryGapRiskThreshold: 0.75,
    fullCoverageThreshold: 1.0,
  };
}

export const DEFAULT_CONFIGURATION: Readonly<RGConfiguration> = buildDefaultConfiguration();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function normalizeSkillName(raw: string, dict: Readonly<Record<string, string>>): string {
  const key = raw.trim().toLowerCase();
  return dict[key] ?? raw.trim();
}

export function getEffectiveRatio(
  supplyLevel: number,
  requiredLevel: number,
  table: ReadonlyArray<RGProficiencyWeightingEntry>,
): number {
  for (const entry of table) {
    if (
      supplyLevel >= entry.minSupplyLevel &&
      requiredLevel >= entry.forMinRequiredLevel &&
      requiredLevel <= entry.forMaxRequiredLevel
    ) {
      // Return first best-match (entries are ordered by minSupplyLevel desc in each required bracket logically,
      // but we keep it explicit: higher minSupplyLevel → higher ratio)
      if (supplyLevel === entry.minSupplyLevel) {
        return entry.effectiveRatio;
      }
    }
  }
  // Fallback: find best applicable entry (highest minSupply <= supply)
  let best: RGProficiencyWeightingEntry | undefined;
  for (const entry of table) {
    if (
      supplyLevel >= entry.minSupplyLevel &&
      requiredLevel >= entry.forMinRequiredLevel &&
      requiredLevel <= entry.forMaxRequiredLevel
    ) {
      if (!best || entry.minSupplyLevel > best.minSupplyLevel) {
        best = entry;
      }
    }
  }
  return best?.effectiveRatio ?? 0;
}

export function parseQuarterLabel(label: string): { quarter: 1 | 2 | 3 | 4; year: number } | null {
  // Accepts "2026-Q2", "Q2-2026", "2026Q2", "2026 Q2"
  const m = label.trim().match(/(?:(\d{4})[\s\-]*Q?([1-4]))|(?:Q([1-4])[\s\-]*(\d{4}))/i);
  if (!m) return null;
  if (m[1] && m[2]) {
    return { quarter: Number(m[2]) as 1 | 2 | 3 | 4, year: parseInt(m[1], 10) };
  }
  if (m[3] && m[4]) {
    return { quarter: Number(m[3]) as 1 | 2 | 3 | 4, year: parseInt(m[4], 10) };
  }
  return null;
}
