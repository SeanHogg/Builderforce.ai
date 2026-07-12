/**
 * @file resource-gap-engine.ts
 * @module @builderforce/resource-gap-engine
 * @description Core engine for resource gap analysis with hiring/deployment/upskill recommendations.
 * Implemenents FR-1 through FR-6 and supports AC-2, AC-3, AC-4, AC-5, AC-9 (zero-data-permission violation). Out-of-scope: RBAC/CLI/docs are reserved for follow-up tasks.
 */

/* ------------------------------------------------------------
Imports & Re-exports
------------------------------------------------------------ */
export type {
  // Core data models
  RGEmployee,
  RGProjectRequirement,
  RGQuarter,
  RGTeam,
  RGProjectOccupancy,
  RGResourceAvailability,
  RGGap,
  RGGapSeverity,
  RGHiringRecommendation,
  RGDeploymentRecommendation,
  RGUpskillRecommendation,
  RGExecutiveSummary,
  RGReport,
  RGConfiguration,
} from './types.ts';

export {
  // Engine
  RESOURCE_GAP_ENGINE_KEY,
  getDefaultSkillDictionary,
  getProficiencyWeighting,
  buildCanonicalSkillDictionary,
  analyzeResourceGaps,
  computeReport,
  computeExecutiveSummary,
} from './engine.ts';

export {
  HiringRecommendationGenerator,
  DeploymentRecommendationGenerator,
  UpskillRecommendationGenerator,
} from './HiringRecommendationGenerator.ts';

export {
  CSVParser,
} from './csv/Parser.ts';

export {
  CSVWriter,
} from './csv/Writer.ts';

export {
  ExecutiveSummaryGenerator,
} from './ExecutiveSummaryGenerator.ts';

export {
  ReportGenerator,
} from './ReportGenerator.ts';