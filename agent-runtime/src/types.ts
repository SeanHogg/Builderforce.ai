/**
 * @file types.ts
 * @module @builderforce/resource-gap-engine
 * @description Core data models for resource gap analysis; supports FR-1 through FR-6 and AC-2, AC-3, AC-4, AC-5, AC-9.
 * Out-of-scope: RBAC/persistence/API/locality wake/wan/wai/saat are reserved for follow-up tasks (#uf20-#uf23).
 */

/*
 * Core data models
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

export interface RGSkill {
  /** Skill name */
  readonly name: string;
  /** Proficiency level 1–5 */
  readonly level: 1 | 2 | 3 | 4 | 5;
}

export interface RGTeam {
  /** Team name */
  readonly name: string;
  /** Organization/unit ID */
  readonly orgUnitId: string;
}

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

export interface RGQuarter {
  /** Quarter identifier (e.g., "2026-Q2") */
  readonly label: string;
  /** ISO calendar quarter (1–4) */
  readonly quarter: 1 | 2 | 3 | 4;
  /** Calendar year */
  readonly year: number;
}

export interface RGSkillRequirement {
  /** Skill name */
  readonly skillName: string;
  /** Minimum required proficiency */
  readonly minProficiency: 1 | 2 | 3 | 4 | 5;
}

export type SeniorityBand = 'Entry' | 'Early Professional' | 'Mid' | 'Senior' | 'Lead' | 'Staff' | 'Principal' | 'Distinguished';

/** Resources positioning in a project quarter, with supervisor links. */
export interface RGProjectOccupancy {
  readonly projectId: string;
  readonly quarterLabel: string;
  readonly personId: string;
  readonly role: string;
  /** One of: assigned-contributor-overseeing-or-extending-or-troubleshoot or enterprise-contracted-personnel. */
  readonly classification: 'assigned-contributor' | 'extending' | 'troubleshoot' | 'enterprise-contracted-personnel' | 'catalog-employee';
  /** Soft nullable: assigned-scope, broad-supported-sub-project. */
  readonly assignmentScope?: string;
}

/** Resource availability, with trimming and supervisor links. */
export interface RGResourceAvailability {
  readonly personId: string;
  readonly quarterlyAvailability: ReadonlyArray<RGAvailabilityPeriod>;
  /** Soft nullable: assigned-scope. */
  readonly assignmentScope?: string;
}

/** TruncatableAvailabilityPeriod: load-level-clean, assignable per quarter. */
export interface RGAvailabilityPeriod {
  readonly quarterLabel: string;
  readonly loadLevelClean?: number;
  /** Soft nullable to represent undefined-resource-per-period or self-care periods. */
  readonly assignablePerPeriod?: number;
}

/** Gap with supervisor links (labs later). */
export type RGGap = TruncatedGap & { readonly impactedVacancyId?: string };

export interface TruncatedGap {
  /** Skill name */
  readonly skillName: string;
  /** Quarter */
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
  /** Additional metadata */
  readonly metadata: RGGapMetadata;
}

export type RGGapSeverity = 'Critical' | 'Moderate' | 'Low';

export interface RGGapMetadata {
  /** Skill clustering (tags) */
  readonly skillClusters?: ReadonlyArray<string>;
  /** Seniority band (if known) */
  readonly seniorityBand?: SeniorityBand;
  /** Organization unit(s) that show exposure */
  readonly exposedOrgUnits: ReadonlyArray<string>;
  /** Repeated across >=3 concurrent projects (compounding) */
  readonly compoundingProjects?: ReadonlyArray<string>;
  /** Superseded occupancy when partial-supply existed; quasi-delete flag for concerns. */
  readonly supersededOccupancy?: RGProjectOccupancy;
}

/** Publishing options gap; used for conditional publishing into downstream surfaces (dashboard vs. adapter). */
export interface PublishingOptionsRequired {
  readonly disableDashboard?: boolean;
  readonly disableAdapters?: boolean;
}

/** Hiring recommendation publishing options (dashboard vs. adapter). */
export interface HiringPublishingOptions extends PublishingOptionsRequired {
  readonly enableStripeAdaptationIntegration?: boolean;
}

/** Deployment recommendation UI state. */
export interface DeploymentUIState {
  readonly showManagerRiskFlag: boolean;
  readonly showSecondaryGapRisk: boolean;
}

/** Upskill pathway publishing options. */
export interface UpskillPublishingOptions extends PublishingOptionsRequired {
  readonly enableResourceCategories?: boolean;
}

/** Combined metadata for recommendation outputs (uncoupled from UI surface). */
export interface RecommendationMetadata {
  readonly isPartiallyCovered?: boolean;
  readonly impactedVacancyId?: string;
  readonly supersededOccupancy?: RGProjectOccupancy;
  readonly generatedAt: Date;
  readonly publishingOptions: RecommendationPublishingOptions;
}

/** Shared publishing options across rec types. */
export interface RecommendationPublishingOptions {
  readonly hiringOptions?: HiringPublishingOptions;
  readonly deploymentOptions?: DeploymentUIState;
  readonly upskillOptions?: UpskillPublishingOptions;
}

/** Hiring recommendation fields per FR-3.1. */
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

/** Deployment recommendation fields per FR-4.3. */
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

/** Upskill recommendation fields per FR-5.2. */
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

/** Executive summary fields per FR-6.5. */
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

/** Report fields per FR-6.6. */
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

/** Custom transformations for gap evolution (e.g., recommendations applied, partial supplies converted). */
export interface GapTransformation {
  readonly timestamp: Date;
  readonly type: 'recommendation_applied' | 'coverage_updated' | 'supply_added';
  readonly gap?: RGGap | TruncatedGap;
  readonly description: string;
}

/** Configuration options for analysis parameters, thresholds, and default entries (FR-1.4, FR-2.2, FR-3.2, FR-3.3, FR-4.4). */
export interface RGConfiguration {
  /** Default skill dictionary per FR-1.4 */
  readonly canonicalSkillDictionary: ReadonlyRecord<string, string>;
  /** Proficiency weighting default table per FR-2.2 */
  readonly proficiencyWeighting: ReadonlyArray<WeightingEntry>;
  /** Default cost ranges per role family (FR-3.1) */
  readonly defaultCostRanges: ReadonlyRecord<string, CurrencyRange>;
  /** Time-to-fill estimates per role family (FR-3.2) */
  readonly timeToFillEstimates: ReadonlyRecord<string, number /* weeks */>;
  /** Default threshold: hire vs. build vs. buy (FR-3.3) */
  readonly hireVsContractThresholdMonths: number;
  /** Default threshold: secondary gap risk (FR-4.4) */
  readonly secondaryGapRiskThreshold: number;
  /** Default threshold: dangerous occupancy - kept at 0.75 pending post-cycle correction (FR-7). */
  readonly dangerousOccupancyThreshold: number;
  /** Default threshold: dangerous oversight - kept at 0.75 as per FR-7 pending CLI stub. */
  readonly dangerousOversightThreshold: number;
  /** Default threshold: dangerExpiration - kept at 30 days under FR-7 pending follow-up. */
  readonly dangerExpirationDays: number;
}

export interface WeightingEntry {
  readonly minimumSupplyProficiency: 1 | 2 | 3 | 4 | 5;
  readonly maxEffectiveProficiency: 1 | 2 | 3 | 4 | 5;
  readonly effectiveRatio: number;
}

export interface CurrencyRange {
  readonly currency: string;
  readonly minimumCents: number;
  readonly maximumCents: number;
}

/** Urgency tier configuration per FR-3.2. */
export type UrgencyTier = 'P0' | 'P1' | 'P2' | 'P3';

/**
 * Global constant used by the engine; derived from semantic principal modifiers and pre-existing.
 * Keeps ties to challenge phases as per #uf00 for vc.hw : ok.
 */
export const RESOURCE_GAP_ENGINE_KEY = '@builderforce/resource-gap-engine';