/**
 * Core data models for resource gap analysis
 * PRD: Resource Gap Analysis with Hiring & Deployment Recommendations
 * FR-1 through FR-6
 */

// ============================================================
// FR-1: Employee / Skill data structures
// ============================================================

export interface RGSkill {
  readonly name: string;
  /** Proficiency level 1 (novice) to 5 (expert) */
  readonly level: 1 | 2 | 3 | 4 | 5;
}

export interface RGEmployee {
  readonly employeeId: string;
  readonly role: string;
  readonly team: string;
  readonly orgUnitId?: string;
  readonly skills: ReadonlyArray<RGSkill>;
  /** e.g. "AMS", "EMEA", "Remote" */
  readonly location: string;
  /** Availability percentage 0–1 (1 = fully available) */
  readonly availability: number;
  /** Optional manager contact / id */
  readonly managerContactId?: string;
}

// ============================================================
// FR-1: Project demand
// ============================================================

export interface RGSkillRequirement {
  readonly skillName: string;
  readonly minProficiency: 1 | 2 | 3 | 4 | 5;
}

export type SeniorityBand =
  | "Entry"
  | "Junior"
  | "Mid"
  | "Senior"
  | "Lead"
  | "Staff"
  | "Principal"
  | "Distinguished";

export interface RGQuarter {
  readonly label: string; // e.g. "2026-Q2"
  readonly quarter: 1 | 2 | 3 | 4;
  readonly year: number;
}

export interface RGProjectRequirement {
  readonly projectId: string;
  readonly requiredSkills: ReadonlyArray<RGSkillRequirement>;
  readonly seniorityBand: SeniorityBand;
  readonly demandFte: number;
  /** Inclusive quarters where demand applies */
  readonly quarters: ReadonlyArray<RGQuarter>;
  /** Team/org that will own the demand */
  readonly targetTeam?: string;
  readonly targetOrgUnitId?: string;
}

// ============================================================
// FR-2: Gap computation
// ============================================================

export type RGGapSeverity = "Critical" | "Moderate" | "Low";

export interface RGGap {
  readonly skillName: string;
  readonly canonicalSkill: string;
  readonly quarter: RGQuarter;
  readonly projectId?: string;
  /** All projects that require this skill in this quarter */
  readonly projectIds: ReadonlyArray<string>;
  readonly demand: number;
  /** Effective supply after proficiency weighting */
  readonly supply: number;
  /** Raw supply (unweighted headcount FTE) */
  readonly rawSupply: number;
  /** Demand - supply (>0 = gap) */
  readonly delta: number;
  /** Coverage ratio (0–1) — supply/demand, capped at 1 */
  readonly coverage: number;
  readonly severity: RGGapSeverity;
  readonly seniorityBand?: SeniorityBand;
  readonly exposedOrgUnits: ReadonlyArray<string>;
  /** True when same skill deficit in >=3 concurrent projects */
  readonly isCompounding: boolean;
  readonly compoundingProjectIds?: ReadonlyArray<string>;
  readonly skillCluster?: string;
}

// ============================================================
// Configuration
// ============================================================

export interface RGProficiencyWeightingEntry {
  /** Minimum proficiency a supplier must have for this entry to apply */
  readonly minSupplyLevel: 1 | 2 | 3 | 4 | 5;
  /** Minimum required proficiency this entry applies to */
  readonly forMinRequiredLevel: 1 | 2 | 3 | 4 | 5;
  /** Max required level this entry applies to (inclusive) */
  readonly forMaxRequiredLevel: 1 | 2 | 3 | 4 | 5;
  /** Effective coverage ratio (0–1) */
  readonly effectiveRatio: number;
}

export interface RGCurrencyRange {
  readonly currency: string;
  readonly minAnnual: number;
  readonly maxAnnual: number;
}

export interface RGConfiguration {
  readonly canonicalSkillDict: Readonly<Record<string, string>>;
  readonly proficiencyWeighting: ReadonlyArray<RGProficiencyWeightingEntry>;
  readonly defaultCostRanges: Readonly<Record<string, RGCurrencyRange>>;
  readonly timeToFillWeeks: Readonly<Record<string, number>>;
  /** Duration (months) below which contract is favored over FTE hire */
  readonly hireVsContractThresholdMonths: number;
  /** Source team coverage threshold below which secondary gap risk is flagged */
  readonly secondaryGapRiskThreshold: number;
  /** Coverage ratio >= this counts as full */
  readonly fullCoverageThreshold: number;
}

// ============================================================
// FR-3: Hiring recommendations
// ============================================================

export type UrgencyTier = "P1" | "P2" | "P3";

export interface RGHiringRecommendation {
  readonly id: string;
  readonly gapId: string;
  readonly roleTitle: string;
  readonly requiredSkills: ReadonlyArray<RGSkillRequirement>;
  readonly seniorityBand: SeniorityBand;
  readonly targetTeam: string;
  readonly demandStartQuarter: RGQuarter;
  readonly urgencyTier: UrgencyTier;
  readonly estimatedTimeToFillWeeks: number;
  readonly estimatedCostRange?: RGCurrencyRange;
  readonly recommendationType: "hire" | "contract";
  readonly demandDurationMonths?: number;
  readonly severity: RGGapSeverity;
  readonly projectIds: ReadonlyArray<string>;
  readonly status: "open" | "in_progress" | "approved" | "deferred";
}

// ============================================================
// FR-4: Deployment recommendations
// ============================================================

export interface RGDeploymentRecommendation {
  readonly id: string;
  readonly gapId: string;
  readonly employee: RGEmployee;
  readonly sourceTeam: string;
  readonly targetProjectId: string;
  readonly targetTeam: string;
  readonly skillMatchScore: number; // 0–1
  readonly proficiencyDelta: number; // negative = employee below requirement
  readonly currentUtilization: number;
  readonly transitionLeadTimeDays: number;
  readonly secondaryGapRisk: boolean;
  readonly secondaryGapDetail?: string;
  readonly recommendationType: "redeploy";
  readonly status: "open" | "in_progress" | "approved" | "deferred";
}

// ============================================================
// FR-5: Upskill pathways
// ============================================================

export type RGLearningResourceCategory =
  | "internal_training"
  | "external_certification"
  | "mentorship"
  | "online_course"
  | "workshop";

export interface RGUpskillRecommendation {
  readonly id: string;
  readonly gapId: string;
  readonly employee: RGEmployee;
  readonly targetSkill: string;
  readonly currentProficiency: number;
  readonly requiredProficiency: number;
  readonly proficiencyDelta: number;
  readonly rampTimeWeeks: number;
  readonly suggestedCategories: ReadonlyArray<RGLearningResourceCategory>;
  readonly projectedReadinessQuarter: RGQuarter;
  readonly isNearMatch: boolean;
  readonly recommendationType: "upskill";
}

// ============================================================
// FR-6: Reports / exports
// ============================================================

export interface RGCoverageScore {
  readonly projectId: string;
  readonly quarter: RGQuarter;
  readonly coverage: number; // 0–1
  readonly totalDemanded: number;
  readonly totalCovered: number;
}

export interface RGExecutiveSummary {
  readonly dateRange: { start: Date; end: Date } | { quarters: ReadonlyArray<RGQuarter> };
  readonly topCriticalGaps: ReadonlyArray<RGGap>;
  readonly topHiringRecommendations: ReadonlyArray<RGHiringRecommendation>;
  readonly deploymentOpportunities: ReadonlyArray<RGDeploymentRecommendation>;
  readonly upskillOpportunities: ReadonlyArray<RGUpskillRecommendation>;
  readonly costEstimate: {
    readonly totalHireCostLow: number;
    readonly totalHireCostHigh: number;
    readonly totalContractCostLow: number;
    readonly totalContractCostHigh: number;
    readonly estimatedSavingsFromRedeployment: number;
  };
  readonly coverageTrend: ReadonlyArray<{ quarter: string; avgCoverage: number }>;
  readonly generatedAt: string; // ISO
}

export interface RGAnalysisResult {
  readonly gaps: ReadonlyArray<RGGap>;
  readonly hiringRecommendations: ReadonlyArray<RGHiringRecommendation>;
  readonly deploymentRecommendations: ReadonlyArray<RGDeploymentRecommendation>;
  readonly upskillRecommendations: ReadonlyArray<RGUpskillRecommendation>;
  readonly coverageScores: ReadonlyArray<RGCoverageScore>;
  readonly executiveSummary: RGExecutiveSummary;
  readonly unmappedSkills: ReadonlyArray<string>;
  readonly metadata: {
    readonly employeeCount: number;
    readonly projectCount: number;
    readonly quarterCount: number;
    readonly analysisRunAt: string;
  };
}

export interface RGCsvEmployeeRow {
  employeeId: string;
  role: string;
  team: string;
  orgUnitId?: string;
  skillName: string;
  skillLevel: number;
  location: string;
  availability: number;
  managerContactId?: string;
}

export interface RGCsvProjectRow {
  projectId: string;
  skillName: string;
  minProficiency: number;
  seniorityBand: SeniorityBand;
  demandFte: number;
  quarterLabel: string;
  targetTeam?: string;
  targetOrgUnitId?: string;
}
