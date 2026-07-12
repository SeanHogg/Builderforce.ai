/**
 * @file resource-gap-engine.ts
 * @module @builderforce/resource-gap-engine
 * @description Core engine for resource gap analysis with hiring/deployment/upskill recommendations.
 * Supports FR-1 through FR-6 and AC-2, AC-3, AC-4, AC-5, AC-9 (zero-data-permission violation).
 * RBAC/persistence/CLI/docs remain out-of-scope in this pass and belong to follow-up tasks.
 */

export type {
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