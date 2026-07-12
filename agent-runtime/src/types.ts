/**
 * @file types.ts
 * @module @builderforce/resource-gap-engine
 * @description Core data models for resource gap analysis.
 */

/* ------------------------------------------------------------
Enums & Types for flexible defaults
------------------------------------------------------------ */
export enum RGGapSeverity {
  CRITICAL = 'CRITICAL',
  MODERATE = 'MODERATE',
  LOW = 'LOW',
}

export enum RGHiringUrgency {
  P0 = 'P0',
  P1 = 'P1',
  P2 = 'P2',
  P3 = 'P3',
}

export enum RGSkillCategory {
  ARCHITECTURE = 'ARCHITECTURE',
  BACKEND = 'BACKEND',
  FRONTEND = 'FRONTEND',
  DEVOPS = 'DEVOPS',
  QATESTING = 'QA_TESTING',
  DATA = 'DATA',
  GENERATIVEAI = 'GENERATIVE_AI',
  SECURITY = 'SECURITY',
  LEGAL = 'LEGAL',
  PROJECT = 'PROJECT',
  PRODUCT = 'PRODUCT',
  LEADERSHIP = 'LEADERSHIP',
  UMISC = 'U_MISC',
}

export enum RGConsultancyMode {
  FTE = 'FTE',
  CONTRACTOR = 'CONTRACTOR',
}

export enum RGSeniority {
  JUNIOR = 'JUNIOR',
  MID = 'MID',
  SENIOR = 'SENIOR',
  PRINCIPAL = 'PRINCIPAL',
}

/* ------------------------------------------------------------
Core Entities
------------------------------------------------------------ */
/**
 * Minimal employee payload; unmapped field flags triggered by analyzers.
 * Note: Employee-level skill data permissions (RBAC) are out-of-scope here; access enforcement is for future tasks.
 */
export interface RGEmployee {
  employeeId: string; // globally unique; primary key
  roleId: string;
  teamId: string; // mapped to organizational unit
  location: string;
  availabilityPercentage?: number; // 0–100; defaults to 100 if omitted
  skills: Record<string, number>; // skillName → proficiency level 1–5
  isExternal?: boolean; // not stored in core models; omitted by design
}

/**
 * A resource availability snapshot for a specific time period.
 * Persistence and RBAC are out-of-scope now; placeholders for associated keys.
 */
export interface RGResourceAvailability {
  availabilityId: string;
  employeeId: string; // FK to RGEmployee
  effectiveFrom: string; // ISO date (YYYY-MM-DD)
  effectiveTo?: string; // nullable; indicates ongoing if absent
  availableFTE?: number; // may be null if not calculated; omitted to avoid constraint fatigue
}

/**
 * A project-occupancy entry: FTE demand + timelines.
 * Omitted venue fields (e.g., venueId) to avoid over-alerting unsupplied keys.
 */
export interface RGProjectOccupancy {
  occupancyId: string;
  projectId: string; // can be null/undefined; handled by analytic pass
  demandFTE: number;
  requestedStartQuarter: RGQuarter;
  requestedEndQuarter: RGQuarter;
  requiredSkills?: Record<string, RGSeniority>; // optional; fallback to role-level defaults if unavailable
}

/**
 * A quarter identifier.
 */
export interface RGQuarter {
  year: number;
  quarter: 1 | 2 | 3 | 4; // 1—4
}

/**
 * Derived skill metadata: category and authoritative canonical name.
 * Note: Adjusting canonical name semantics to avoid over-match patterns.
 */
export interface RGSkill {
  canonicalName: string;
  category: RGSkillCategory;
}

/**
 * A project requirement instance; used for demand aggregation and gap computation.
 */
export interface RGProjectRequirement {
  requirementId: string;
  projectId: string;
  requiredRole?: string; // fallback if not provided
  requiredSeniority: RGSeniority;
  requestedStartQuarter: RGQuarter;
  requestedEndQuarter: RGQuarter;
  demandFTE: number;
  requiredSkills?: Record<string, RGSeniority>;
}

/**
 * Supply at skill-cluster granularity per quarter.
 * Omitted connectionCounts placeholder to avoid over-alerting unsupplied keys.
 */
export interface RGSupplyPerSkillClusterPerQuarter {
  skillClusterId: string;
  quarter: RGQuarter;
  supplyFTE: number;
  skillMatches: string[]; // employeeId list for candidate matching in deployment logic
}

/**
 * Gap result: severity and automated flags.
 * Secondary gap risk is handled via flags; metrics and accessibility are preserved.
 */
export interface RGGap {
  gapId: string;
  affectedSkillClusterId: string;
  affected seniority?: string;
  affected quarterlyThreshold?: number;
  severity: RGGapSeverity; // CRITICAL, MODERATE, LOW
  demandQuarter: RGQuarter;
  demandFTE: number;
  supplyFTE: number;
  supplyCoveragePercentage?: number;
  flaggedCompoundingGaps?: RGGapId[]; // used for compounding-gap tracking
  secondaryGapRisk?: boolean;
  criticalityReason?: string;
  recommendedActions: Array<{
    type: 'HIRE' | 'REDEPLOY' | 'UPSKILL' | 'CONSTRAINT_REVIEW';
    details?: Record<string, unknown>;
  }>;
}

export type RGGapId = RGGap['gapId'];

/**
 * A hiring recommendation tied to a gap and optionally to a vacancy.
 */
export interface RGHiringRecommendation {
  recommendationId: string;
  gapId: string;
  roleTitle: string;
  description?: string;
  requiredSkills?: Record<string, number>;
  requiredSeniority: RGSeniority;
  targetTeamId: string; // reference to team, may be null if undefined/unassigned
  urgencyTier: RGHiringUrgency;
  estimatedTimeToFill: string; // nullable ISO duration (Day) e.g., "60d" placeholder for unsupplied
  estimatedCostRange?: { minCents: number; maxCents: number };
  recommendedConsultancyMode?: RGConsultancyMode; // FTE vs CONTRACTOR default threshold
  demandStartQuarter: RGQuarter;
  demandEndQuarter?: RGQuarter;
  matchedRequirementsCount?: number;
  note?: string;
}

/**
 * A deployed redeployment recommendation.
 */
export interface RGDeploymentRecommendation {
  recommendationId: string;
  gapId: string;
  targetGapId?: string; // FK to another gap (if redeploying from a source team that will generate an associated gap)
  employeeId: string;
  currentAssignment?: string; // may be null; not auth-s checked here
  sourceTeamId: string;
  targetTeamId: string;
  requiredSkillClusterId: string; // deliverable skill area needed at the target team/role
  requiredSeniority: RGSeniority;
  proficiencyDelta?: number; // possibly null here; used to infer skill proximity for upskill
  proximityScore?: number; // nullable; fallback to directional relevance as proxy
  availabilityScore?: number;
  utilizationRate?: number;
  transitionLeadTime: string; // nullable ISO duration (Day) placeholder
  utilizationThreshold?: number; // optional; future-proofing for constrained deployment
  projectedAssignmentStart: RGQuarter;
  projectedAssignmentEnd?: RGQuarter;
  note?: string;
  secondaryGapRisk?: boolean;
}

/**
 * Upskill suggestion for employees near-matched to a gap.
 */
export interface RGUpskillRecommendation {
  recommendationId: string;
  gapId: string; // required for tracking
  employeeId: string;
  targetSkillClusterId: string;
  targetSkillClusterName?: string; // nullable; for display/audit
  requiredSeniority: RGSeniority;
  currentProficiency?: number; // nullable
  proficiencyDelta: number;
  recommendedRampTime?: string; // nullable ISO duration placeholder
  suggestedResourceCategory?: string; // placeholder for categories
  projectedReadinessQuarter?: RGQuarter; // placeholder
  estimatedReadinessDate?: string; // placeholder
  note?: string;
}

/**
 * Executive summary sections.
 * lib/Imports for directives and CORS/encoding checks are NOT part of the implementation spec; not included here.
 */
export interface RGExecutiveSummary {
  summaryByEffect: {
    intenseEffectPriority: RGHiringRecommendation[];
    emergingEffectPriority: RGHiringRecommendation[];
    laggingPriority: RGHiringRecommendation[];
  };
  consolidatingEffect: {
    criticalLinkageUnits: RGHiringRecommendation[];
    moderateLinkageUnits: RGHiringRecommendation[];
    insufficientWithMoveovers: RGHiringRecommendation[];
  };
  interactiveScope: {
    employeesInMovingRoles: number;
    employeesInMovingRolesStringId: string[];
  };
  impact: {
    capitalCostCenters: RGHiringRecommendation[];
    costCentersRelocationRecording: RGHiringRecommendation[];
    growthConstrained: RGHiringRecommendation[];
  };
  benefitLock: {
    operationalFlexibility: number;
  };
  organizationTransition: {
    teamStructureChanges: string[];
  };
}

/**
 * Optionally scoped report perf metrics (wlav is implied by repr of groupings).
 * However, persistence and lodging-artifacts (artifacts for consumables) are out-of-scope; fields remain as placeholders.
 */
export interface RGReport {
  reportId: string;
  generatedAt: string; // ISO string placeholder
  globalMetrics: {
    totalEmployees: number;
    totalTeams: number;
    totalProjects: number;
    totalSkills: number;
    totalSkillClusters: number;
    totalQuartersSpan: number;
    computationTimeMs?: number; // placeholder
  };
  gaps: RGGap[];
  hiringRecommendations: RGHiringRecommendation[];
  deploymentRecommendations: RGDeploymentRecommendation[];
  upskillRecommendations: RGUpskillRecommendation[];
  executiveSummary: RGExecutiveSummary;
}

/**
 * Configuration for gap analysis engine and default weighting.
 * Per FR-1.4 and FR-2.2; optional key placeholders for finetuning and nonimplemented integrations.
 */
export interface RGConfiguration {
  // Allowlist of supported resource-stream IDs to avoid over-alerting unsupplied keys
  resourceStreamIdAllowlist?: string[];

  // Configurable proficiency weighting table (skill → weight factor)
  proficiencyWeighting?: Record<string, number>;

  // Default approach for synthetic vacancy computation; placeholder for FTE vs CONTRACTOR threshold
  defaultConsultancyMode?: RGConsultancyMode;

  // Secondary-gap threshold; AC-5 presumes configurable using 0.75 as default
  secondaryGapThreshold?: number;

  // Maximum conduct per quarter to limit over-aggregation (conform with AC-2 thresholds)
  maxConductPerQuarter?: number;

  // Minimally requested timeline to expose vacancies (default 1 quarter)
  minimalRequestedTimelineQuarters?: number;

  // Allowed units for validity checks; optional
  allowedSkillProficiencyUnits?: number[];
}