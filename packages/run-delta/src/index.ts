/**
 * `@builderforce/run-delta` — THE run delta engine (PRD 41 Part C, WS7 core plus the first WS8/WS9
 * dimension rules). Pure and Worker-safe: no I/O, no clock, no randomness; hosts supply
 * {@link DeltaPorts}. No user-facing strings: verdicts, reasons and the headline are codes and counts,
 * rendered by the localized UI.
 */

export * from './contract.js';
export { blockingCodes, computeRunDelta } from './engine/computeRunDelta.js';
export { matchRenames, RENAME_MIN_JACCARD, type RenamePair, type RenameSide } from './engine/renames.js';
export { impactSet, reverseImports, DEPENDENT_HOPS, ENTRY_BADGES, type ImpactSet } from './engine/impactSet.js';
export { dimensionVerdict, metricLevels, worst, VERDICT_POLICIES, type VerdictPolicy } from './engine/verdict.js';
export { headlineModel } from './engine/headline.js';
export {
    blastRadius, fileCentrality, BLAST_RADIUS_DAMPING, BLAST_RADIUS_ITERATIONS, ENTRY_POINT_WEIGHT, MIN_PAST_SCORES,
} from './engine/blastRadius.js';
export { canonicalDelta, digestOf, DEFAULT_DIGEST_STEP, DIGEST_STEPS } from './engine/digest.js';
export { DEFAULT_REGISTRIES, DELTA_CONFIG_RULE, TEST_INTEGRITY_ERROR_RULES, TEST_INTEGRITY_RULES } from './registry/defaults.js';
export { withOverrides, type OverrideResult } from './registry/overrides.js';
export { unsafeRegex, MAX_OVERRIDE_REGEX_LENGTH, type UnsafeReason } from './registry/safeRegex.js';
export { DELTA_CONFIG_PATH } from './rules/deltaConfigChanged.js';
export { extractNamedPaths, globBase, listingOf, planSection, pathCandidates, resolveNamedPaths, MAX_NAMED_PATHS, type PathListing } from './rules/quality/namedPaths.js';
export { isFresh, isOpen } from './engine/findingFacts.js';
export { ALL_DIMENSIONS, defaultDimensionRegistry } from './registry/dimensions.js';
export { BUILT_IN_METRICS, BUILT_IN_RULES } from './rules/index.js';
export { FACT_FINDING_KINDS } from './rules/factFindings.js';
export { STRIDE_BY_RULE, STRIDE_CATEGORIES, strideOf, withStride, type StrideByParam } from './registry/stride.js';
export { ANALYZER_RULES, ANALYZER_TOOLS, OSV_MAX_DATA_AGE_DAYS } from './registry/analyzers.js';
export { analyzerKindTools } from './engine/analyzers.js';
export { hasPendingAnalyzers, settlePendingAnalyzers } from './engine/settlePending.js';
export * from './dynamic/index.js';
export { summarizeRunDelta, type RunDeltaSummary, type RunDeltaSurface, type StoredRunDelta } from './summary.js';
export { CLOUD_RUN_ID_PREFIX, cloudRunId } from './runIds.js';
export { baselineStateOf, runDeltaToSarif, RUN_DELTA_TOOL } from './sarifExport.js';
