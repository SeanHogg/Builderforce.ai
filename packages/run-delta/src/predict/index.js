/**
 * `@builderforce/run-delta/predict` — the run-outcomes context's pure half (PRD 41 Part D, WS16): the frozen
 * `RunFeatures` vector with its leakage guard, and the outcome labellers over git history as data. Advisory only (D0):
 * nothing in the engine, the rules or a verdict imports this subpath.
 */
export * from './contract.js';
export { FEATURE_DEFS, FEATURE_IDS, FEATURE_IDS_BY_SCHEMA, FEATURE_STEP, FeatureLeakageError, canonicalFeatures, changeEntropy, featureDigest, freezeRunFeatures, lineDelta, pointInTime, } from './features.js';
export { blamedToRun, parseBlamePorcelain, parseRemovedLines, runCommitIndex, } from './labels/history.js';
export { LOG_RS, LOG_US, parseLogPatch, unquoteGitPath } from './labels/history.js';
export { maskChange } from './labels/szz.js';
export { DAY_MS, finalizeCensored, windowElapsed, windowEnd, windowedLabel, within } from './labels/window.js';
export { FIX_MESSAGE_PATTERNS, isCosmeticChange, isFixCommit, isFixMessage, labelFollowupFix, runLinesTouched } from './labels/szz.js';
export { REVERT_DELETED_SHARE, labelReverted, revertedShas } from './labels/revert.js';
export { jobTouches, labelCiRedAfterMerge } from './labels/ci.js';
export { labelFindingAction, labelReviewRejected } from './labels/review.js';
export { carryStoredEvent, labelSupersedes, mergeLabels } from './labels/merge.js';
export { EXPLAINED_LINES, MAX_BASELINE_LINES, MAX_SCORED_LINES, MIN_BASELINE_LINES, MIN_LINE_TOKENS, NATURALNESS_MODEL_ID, NATURALNESS_MODEL_VERSION, NATURALNESS_PREDICTION_ID, NATURALNESS_SCHEMA_VERSION, SURPRISAL_STEP, UNUSUAL_Z, naturalnessCollector, naturalnessLanguageOf, predictNaturalness, } from './naturalness.js';
export { CHECK_COST, CHECK_EXPECTED_MS, CHECK_SCHEDULER_MODEL_ID, CHECK_SCHEDULER_MODEL_VERSION, COST_ARM_CONCENTRATION, DIMENSION_VALUE, EXPLORATION_SHARE, MIN_CHECK_OBSERVATIONS, PRIOR_STRENGTH, hasScheduleHistory, runThreshold, thompsonScheduler, } from './scheduler.js';
export { EXPLORE_POLICY, THOMPSON_POLICY, cellDimensions, contextCell, dynamicCheckOutcomes, scheduleCellKey, scheduleHistoryOf, scheduleTelemetry, } from './scheduleHistory.js';
export { decisiveDimensions } from './credit.js';
//# sourceMappingURL=index.js.map