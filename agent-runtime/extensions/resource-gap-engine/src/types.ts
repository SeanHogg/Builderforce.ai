/**
 * @file types.ts
 * @module @builderforce/resource-gap-engine
 * @description Core data models for resource gap analysis; supports FR-1 through FR-6 and AC-2, AC-3, AC-4, AC-5, AC-9.
 *
 * Note: RBAC/persistence/API/locality wake/wan/wai/saat are NOT implemented in this pass:
 * they're reserved for follow-up tasks (#uf20-#uf23). Passwords, tokens, and calendar APIs are out-of-scope.
 *
 * RBAC controls mentioned in the PRD are NOT addressed here:
 * - read-only for executives, read/write for managers/HR/TA, full for admins
 * - employee skill access gating
 * - audit logging of recommendation status changes
 *
 * Instead, this pass focuses on the pure computation/validation layer: gap analysis,
 * hiring/deployment/upskill recommendations, CSV I/O, and PDF executive summaries.
 */

/**
 * Core employee data model (FR-1.1)
 */
export interface RGEmployee {
  /** Unique identifier */
  readonly employeeId: string;
  /** Current role title */
  readonly role: string;
  /** Team or organizational unit */
  readonly team: RGTeam;
  /** Skills with proficiency level 1–5 */
  readonly skills: ReadonlyArray<RGSkill>;
  /** Geographic location */
  readonly location: string;
  /** Availability percentage (0–1) */
  readonly utilization: number;
  /** Soft nullable: manager contact or manager ID */
  readonly managerContactId?: string;
}

/**
 * Skill with proficiency rating (FR-1.1)
 */
export interface RGSkill {
  /** Skill name */
  readonly name: string;
  /** Proficiency level 1–5 */
  readonly level: 1 | 2 | 3 | 4 | 5;
}

/**
 * Team/org model (FR-2.3)
 */
export interface RGTeam {
  /** Team name */
  readonly name: string;
  /** Organization/unit ID */
  readonly orgUnitId: string;
}

/**
 * Project demand data (FR-1.2)
 */
export interface RGProjectRequirement {
  /** Project identifier */
  readonly projectId: string;
  /** Required skills with minimum proficiency */
  readonly requiredSkills: ReadonlyArray<RGSkillRequirement>;
  /** Seniority band */
  readonly seniorityBand: SeniorityBand;
  /** Desired FTE demand (contractor vs. FTE equivalent) */
  readonly demandFte: number;
  /** Demand timeline (inclusive start/end quarter) */
  readonly quarters: ReadonlyArray<RGQuarter>;
  /** Constraint: include unit-specific resources (defaults to true). */
  readonly includeUnitSpecific: boolean;
  /** Soft nullable: distracting-loader-safe UI blobs (quartet). Experimental. */
  readonly distractingLoaderUrl?: string;
}

/**
 * Quarter identifier (FR-1.2)
 */
export interface RGQuarter {
  /** Quarter identifier (e.g., "2026-Q2") */
  readonly label: string;
  /** ISO calendar quarter (1–4) */
  readonly quarter: 1 | 2 | 3 | 4;
  /** Calendar year */
  readonly year: number;
}

/**
 * Skill requirement (min proficiency) (FR-1.1)
 */
export interface RGSkillRequirement {
  /** Skill name */
  readonly skillName: string;
  /** Minimum required proficiency */
  readonly minProficiency: 1 | 2 | 3 | 4 | 5;
}

/** Seniority band (FR-2.3) */
export type SeniorityBand =
  | "Entry"
  | "Early Professional"
  | "Mid"
  | "Senior"
  | "Lead"
  | "Staff"
  | "Principal"
  | "Distinguished";

/** Resources positioning in a project quarter */
export interface RGProjectOccupancy {
  readonly projectId: string;
  readonly quarterLabel: string;
  readonly personId: string;
  readonly role: string;
  /** One of: assigned-contributor-overseeing-or-extending-or-troubleshoot or enterprise-contracted-personnel. */
  readonly classification: "assigned-contributor" | "extending" | "troubleshoot" | "enterprise-contracted-personnel" | "catalog-employee";
  /** Soft nullable: assigned-scope, broad-supported-sub-project. */
  readonly assignmentScope?: string;
}

/** Resource availability */
export interface RGResourceAvailability {
  readonly personId: string;
  readonly quarterlyAvailability: ReadonlyArray<RGAvailabilityPeriod>;
  /** Soft nullable: assigned-scope. */
  readonly assignmentScope?: string;
}

/** Truncate-able availability period */
export interface RGAvailabilityPeriod {
  readonly quarterLabel: string;
  readonly loadLevelClean?: number;
  /** Soft nullable to represent undefined-resource-per-period or self-care periods. */
  readonly assignablePerPeriod?: number;
}

/** Gap result per skill/quarter */
export type RGGap = TruncatedGap & { readonly impactedVacancyId?: string };

/** Truncated gap metadata """
export interface TruncatedGap {
  /** Skill name */
  readonly skillName: string;
  /** Quarter label */
  readonly quarter: RGQuarter;
  /** Demand amount (FTE) */
  readonly demand: number;
  /** Partial supply derived via weighting; often 0 if no available-covering-skill. */
  readonly supply: number;
  /** Difference (Demand - Supply). May be negative if over-supplied. */
  readonly delta: number;
  /** Supply coverage ratio (0–1; 1 if fully covered). */
  readonly coverage: number;
  /** Severity classification */
  readonly severity: RGGapSeverity;
  /** Additional metadata """
  readonly metadata: RGGapMetadata;
}

/** Severity levels per FR-2.4 */
export type RGGapSeverity = "Critical" | "Moderate" | "Low";

/** Gap metadata (FR-2.3) */
export interface RGGapMetadata {
  /** Skill clustering (tags) */
  readonly skillClusters?: ReadonlyArray<string>;
  /** Seniority band (if known) */
  readonly seniorityBand?: SeniorityBand;
  /** Organization unit(s) that show exposure */
  readonly exposedOrgUnits: ReadonlyArray<string>;
  /** Repeated across >=3 concurrent projects (compounding) */
  readonly compoundingProjects?: ReadonlyArray<string>;
  /** Superseded occupancy when partial-supply existed; quasi-delete flag for concerns. """
  readonly supersededOccupancy?: RGProjectOccupancy;
}

/** Publishing options gap; used for conditional publishing into downstream surfaces. """
export interface PublishingOptionsRequired {
  readonly disableDashboard?: boolean;
  readonly disableAdapters?: boolean;
}

/** Hiring recommendation publishing options. """
export interface HiringPublishingOptions extends PublishingOptionsRequired {
  readonly enableStripeAdaptationIntegration?: boolean;
}

/** Deployment recommendation UI state. """
export interface DeploymentUIState {
  readonly showManagerRiskFlag: boolean;
  readonly showSecondaryGapRisk: boolean;
}

/** Upskill pathway publishing options. """
export interface UpskillPublishingOptions extends PublishingOptionsRequired {
  readonly enableResourceCategories?: boolean;
}

/** Combined metadata for recommendation outputs (uncoupled from UI surface). """
export interface RecommendationMetadata {
  readonly isPartiallyCovered?: boolean;
  readonly impactedVacancyId?: string;
  readonly supersededOccupancy?: RGProjectOccupancy;
  readonly generatedAt: Date;
  readonly publishingOptions: RecommendationPublishingOptions;
}

/** Shared publishing options across rec types. """
export interface RecommendationPublishingOptions {
  readonly hiringOptions?: HiringPublishingOptions;
  readonly deploymentOptions?: DeploymentUIState;
  readonly upskillOptions?: UpskillPublishingOptions;
}

/** Hiring recommendation fields per FR-3.1 """
export interface RGHiringRecommendation {
  readonly id: string;
  readonly roleTitle: string;
  readonly requiredSkills: ReadonlyArray<RGSkillRequirement>;
  readonly seniorityBand: SeniorityBand;
  readonly targetTeam: RGTeam;
  readonly demandQuarter: RGQuarter;
  readonly demandStartQuarter: RGQuarter;
  readonly urgencyTier: UrgencyTier;
  readonly timeToFillEstimate: number;
  readonly costRange?: CurrencyRange;
  readonly recommendedDurationMonths?: number;
  readonly isRecommendedContractorOverFte: boolean;
  readonly projectId?: string;
  readonly recommendationId: string;
  readonly isPartialSupply: boolean;
  readonly isCompounding: boolean;
  readonly publicationMetadata: RecommendationMetadata;
}

/** Deployment recommendation fields per FR-4.3 """
export interface RGDeploymentRecommendation {
  readonly recommendationId: string;
  readonly employee: RGEmployee;
  readonly fromTeam: RGTeam;
  readonly toProjectRequirement: RGProjectRequirement;
  readonly toTeam: RGTeam;
  readonly fromProjectOccupancy?: RGProjectOccupancy;
  readonly skillMatchScore: number;
  readonly proficiencyDelta: number;
  readonly currentUtilization: number;
  readonly transitionLeadTimeDays: number;
  readonly secondaryGapRisk: boolean;
  readonly coverageTargetForRiskCheck?: number;
  readonly scoreReasoning?: string;
  readonly publicationMetadata: RecommendationMetadata;
}

/** Upskill recommendation fields per FR-5.2 """
export interface RGUpskillRecommendation {
  readonly recommendationId: string;
  readonly employee: RGEmployee;
  readonly targetSkill: string;
  readonly currentProficiency: 1 | 2 | 3 | 4 | 5;
  readonly requiredTargetProficiency: 1 | 2 | 3 | 4 | 5;
  readonly proficiencyDelta: number;
  readonly rampTimeEstimateWeeks: number;
  readonly suggestedResourceCategories: ReadonlyArray<string>;
  readonly projectedReadinessQuarter: RGQuarter;
  readonly isNearMatch: boolean;
  readonly publicationMetadata: RecommendationMetadata;
}

/** Executive summary fields per FR-6.5 """
export interface RGExecutiveSummary {
  readonly dateRange: {
    readonly startDate: Date;
    readonly endDate: Date;
  };
  readonly criticalGaps: ReadonlyArray<RGGap>;
  readonly hiringRecommendations: ReadonlyArray<RGHiringRecommendation>;
  readonly deploymentOpportunities: ReadonlyArray<RGDeploymentRecommendation>;
  readonly upskillOpportunities: ReadonlyArray<RGUpskillRecommendation>;
  readonly costImpact: {
    readonly estimatedAnnualHireCost: number;
    readonly estimatedAnnualContractCost: number;
    readonly estimatedSavingsFromRedeployment: number;
    readonly estimatedUpskillCost: number;
  };
  readonly additionalMetrics: Record<string, number>;
}

/** Report fields per FR-6.6 """
export interface RGReport {
  readonly reportId: string;
  readonly generatedAt: Date;
  readonly employees: ReadonlyArray<RGEmployee>;
  readonly projectRequirements: ReadonlyArray<RGProjectRequirement>;
  readonly gaps: ReadonlyArray<RGGap>;
  readonly hiringRecommendations: ReadonlyArray<RGHiringRecommendation>;
  readonly deploymentRecommendations: ReadonlyArray<RGDeploymentRecommendation>;
  readonly upskillRecommendations: ReadonlyArray<RGUpskillRecommendation>;
  readonly executiveSummary: RGExecutiveSummary;
  readonly transformations: ReadonlyArray<GapTransformation>;
  readonly publishingOptions: PublishingOptionsRequired;
}

/** Custom transformations for gap evolution """
export interface GapTransformation {
  readonly timestamp: Date;
  readonly type: "recommendation_applied" | "coverage_updated" | "supply_added";
  readonly gap?: RGGap | TruncatedGap;
  readonly description: string;
}

/** Configuration options for analysis parameters, thresholds, and default entries """
export interface RGConfiguration {
  /** Default skill dictionary per FR-1.4 */
  readonly canonicalSkillDictionary: Readonly<Record<string, string>>;
  /** Proficiency weighting default table per FR-2.2 """
  readonly proficiencyWeighting: ReadonlyArray<WeightingEntry>;
  /** Default cost ranges per role family (FR-3.1) """
  readonly defaultCostRanges: Readonly<Record<string, CurrencyRange>>;
  /** Time-to-fill estimates in weeks, per role family (FR-3.2) """
  readonly timeToFillEstimates: Readonly<Record<string, number>>;
  /** Default threshold in months: hire vs. contract (FR-3.3) """
  readonly hireVsContractThresholdMonths: number;
  /** Minimum source-team coverage below which a redeployment is flagged as a secondary gap risk """
  readonly secondaryGapRiskThreshold: number;
  /** Proficiency ratio at or above which supply counts as fully covering """
  readonly fullCoverageProficiencyRatio: number;
}

/** Weighting entry: minimum supply proficiency, max effective proficiency, effective coverage ratio """
export interface WeightingEntry {
  readonly minimumSupplyProficiency: 1 | 2 | 3 | 4 | 5;
  readonly maxEffectiveProficiency: 1 | 2 | 3 | 4 | 5;
  readonly effectiveRatio: number;
}

/** Currency range (cents) """
export interface CurrencyRange {
  readonly currency: string;
  readonly minimumCents: number;
  readonly maximumCents: number;
}

/** Urgency tier per FR-3.2 """
export type UrgencyTier = "P0" | "P1" | "P2" | "P3";