/**
 * Resource Gap Analysis — core domain types
 * Maps to FR-1 .. FR-6 of the resource-gap PRD.
 */

export type SkillProficiency = 1 | 2 | 3 | 4 | 5;
export type SeniorityBand = "junior" | "mid" | "senior" | "staff" | "principal";
export type GapSeverity = "critical" | "moderate" | "low";
export type UrgencyTier = "P1" | "P2" | "P3";
export type RecommendationType = "hire" | "contract" | "deploy" | "upskill";
export type RecommendationStatus = "open" | "in_progress" | "approved" | "deferred";
export type LearningCategory = "internal_training" | "external_certification" | "mentorship" | "self_paced";

export interface EmployeeSkill {
  skillId: string; // canonical or original — normalized during ingest
  proficiency: SkillProficiency;
  lastAssessedAt?: string;
}

export interface Employee {
  id: string;
  name?: string;
  currentRole: string;
  seniority: SeniorityBand;
  team: string; // org unit
  location: string;
  availabilityPct: number; // 0-100
  skills: EmployeeSkill[];
  managerContact?: string;
  currentProjectEndDate?: string; // ISO — for transition lead time
}

export interface ProjectDemandSkill {
  skillId: string; // canonical or original
  minProficiency: SkillProficiency;
  fteDemand: number;
}

export interface ProjectDemand {
  projectId: string;
  projectName?: string;
  team?: string; // requesting team
  location?: string;
  requiredSeniority?: SeniorityBand;
  requiredSkills: ProjectDemandSkill[];
  demandStartQuarter: string; // e.g. "2026-Q2" or "2026Q2" → normalized YYYY-Qn
  demandEndQuarter: string;
  demandStartDate?: string; // ISO optional detail
  demandEndDate?: string;
}

export type Quarter = string; // "YYYY-Qn" canonical

// ── Gap result (FR-2) ────────────────────────────────────────────────

export interface SkillGap {
  skillId: string;
  quarter: Quarter;
  demandFTE: number;
  weightedSupplyFTE: number; // proficiency-weighted
  rawSupplyFTE: number;
  gapFTE: number; // demand - weightedSupply
  uncoveredPct: number; // 0..1  (gap / demand when demand>0, else 0)
  severity: GapSeverity;
  team?: string; // optional segmentation
  location?: string;
  seniority?: SeniorityBand;
  compoundingProjectIds?: string[]; // FR-2.5 — projectIds that share this gap
  compoundingProjectCount?: number;
}

export interface GapComputationResult {
  gaps: SkillGap[];
  projectCoverage: ProjectCoverage[]; // FR-6.2
  unmappedSkills: UnmappedSkill[];
  totalDemandFTE: number;
  totalWeightedSupplyFTE: number;
  computedAt: string;
}

export interface ProjectCoverage {
  projectId: string;
  demandFTE: number;
  coveredFTE: number;
  coverageScore: number; // 0..1
}

// ── Recommendations (FR-3 / FR-4 / FR-5) ────────────────────────────

export interface BaseRecommendation {
  id: string;
  gap: { skillId: string; quarter: Quarter; team?: string; location?: string; seniority?: SeniorityBand };
  type: RecommendationType;
  status: RecommendationStatus;
  costBand?: { min: number; max: number; currency?: string };
  createdAt: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface HiringRecommendation extends BaseRecommendation {
  type: "hire" | "contract";
  roleTitle: string;
  requiredSkills: { skillId: string; minProficiency: SkillProficiency }[];
  seniority: SeniorityBand;
  targetTeam: string;
  demandStartDate?: string; // ISO
  demandStartQuarter: Quarter;
  durationMonths?: number;
  urgency: UrgencyTier;
  estimatedTimeToFillDays: number;
  isPotentiallyContract: boolean; // FR-3.3
  contractorRationale?: string;
  // costBand inherited
}

export interface DeploymentCandidate {
  employeeId: string;
  employeeName?: string;
  currentRole: string;
  currentTeam: string;
  currentProjectEndDate?: string;
  skillMatchScore: number; // 0..1
  proficiencyDelta: number; // employee - required (can be negative)
  utilizationRate: number; // 0..1 = 1 - availabilityPct/100 roughly? Supply-based
  transitionLeadTimeDays: number;
  rationale: string;
  managerContact?: string;
  secondaryGapRisk: boolean;
  secondaryGapDetail?: string;
}

export interface DeploymentRecommendation extends BaseRecommendation {
  type: "deploy";
  urgency: UrgencyTier;
  candidates: DeploymentCandidate[];
  topCandidateId?: string;
}

export interface UpskillRecommendation extends BaseRecommendation {
  type: "upskill";
  employeeId: string;
  employeeName?: string;
  currentTeam: string;
  currentProficiency: SkillProficiency;
  targetProficiency: SkillProficiency;
  category: LearningCategory;
  estimatedRampTimeDays: number;
  projectedReadinessDate: string; // ISO
  rationale: string;
}

// ── Ingestion (FR-1) ─────────────────────────────────────────────────

export interface IngestResult<T> {
  records: T[];
  errors: IngestError[];
  unmappedSkills: UnmappedSkill[];
  summary: { total: number; accepted: number; errorCount: number; unmappedCount: number };
}

export interface IngestError {
  rowIndex: number;
  message: string;
  field?: string;
}

export interface UnmappedSkill {
  skillId: string;
  occurrenceCount: number;
  exampleContext?: string;
}

// Canonical skill dictionary entry (FR-1.4)
export interface CanonicalSkillEntry {
  canonicalId: string;
  cluster?: string;
  aliases?: string[];
}

// ── Engine inputs/outputs ────────────────────────────────────────────

export interface GapEngineInput {
  employees: Employee[];
  demands: ProjectDemand[];
  skillDictionary?: CanonicalSkillEntry[];
  // Optional: proficiency weighting overrides — merged with default config.
  proficiencyWeights?: ProficiencyWeightEntry[];
}

export interface GapEngineOutput extends GapComputationResult {
  hiringRecommendations: HiringRecommendation[];
  deploymentRecommendations: DeploymentRecommendation[];
  upskillRecommendations: UpskillRecommendation[];
}

// ── Dashboard helpers ────────────────────────────────────────────────

export interface HeatmapCell {
  skillId: string;
  quarter: Quarter;
  severity: GapSeverity | null;
  gapFTE: number;
  uncoveredPct: number;
}

export interface RecommendationQueueRow {
  id: string;
  type: RecommendationType;
  urgency: UrgencyTier;
  skillId: string;
  team?: string;
  status: RecommendationStatus;
  quarter: Quarter;
}

export interface TrendPoint {
  date: string; // ISO week bucket
  gapFTE: number;
  coveredFTE: number;
  demandFTE: number;
}

// FR-6.5
export interface ExecutiveSummary {
  generatedAt: string;
  dateRange: { from: string; to: string };
  topCriticalGaps: SkillGap[];
  topHiringRecommendations: HiringRecommendation[];
  deploymentOpportunities: DeploymentRecommendation[];
  costImpactEstimate: { fteCostRange: { min: number; max: number }; contractorCostRange?: { min: number; max: number } };
  trend?: TrendPoint[];
}

// Proficiency weighting (FR-2.2)
export interface ProficiencyWeightEntry {
  supplyLevel: SkillProficiency;
  requiredLevel: SkillProficiency;
  ratio: number; // 0..1
}
