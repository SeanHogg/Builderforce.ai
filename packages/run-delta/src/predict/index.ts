/**
 * `@builderforce/run-delta/predict` — the run-outcomes context's pure half (PRD 41 Part D, WS16): the frozen
 * `RunFeatures` vector with its leakage guard, and the outcome labellers over git history as data. Advisory only (D0):
 * nothing in the engine, the rules or a verdict imports this subpath.
 */

export * from './contract.js';
export {
    FEATURE_DEFS, FEATURE_IDS, FEATURE_IDS_BY_SCHEMA, FEATURE_STEP, FeatureLeakageError, canonicalFeatures, changeEntropy, featureDigest, freezeRunFeatures, lineDelta, pointInTime,
    type FeatureContext, type FeatureDef, type RunFeatureInputs, type Timed,
} from './features.js';
export {
    blamedToRun, parseBlamePorcelain, parseRemovedLines, runCommitIndex,
    type BlamedLine, type FileChange, type HistoryCommit, type RunCommits,
} from './labels/history.js';
export { LOG_RS, LOG_US, parseLogPatch, unquoteGitPath, type PatchedCommit } from './labels/history.js';
export { maskChange, type MaskedChange } from './labels/szz.js';
export { DAY_MS, finalizeCensored, windowElapsed, windowEnd, windowedLabel, within } from './labels/window.js';
export { FIX_MESSAGE_PATTERNS, isCosmeticChange, isFixCommit, isFixMessage, labelFollowupFix, runLinesTouched, type SzzInput } from './labels/szz.js';
export { REVERT_DELETED_SHARE, labelReverted, revertedShas, type RevertInput } from './labels/revert.js';
export { jobTouches, labelCiRedAfterMerge, type CiInput, type CiRun } from './labels/ci.js';
export { labelFindingAction, labelReviewRejected, type FindingActionKind, type ReviewInput } from './labels/review.js';
export { carryStoredEvent, labelSupersedes, mergeLabels, type LabelPrecedence } from './labels/merge.js';
// Part D models (WS19 onwards): every model answers with THE `Prediction` shape (§D0.2).
export type { Prediction, PredictionContribution, PredictionStatus } from './prediction.js';
export {
    EXPLAINED_LINES, MAX_BASELINE_LINES, MAX_SCORED_LINES, MIN_BASELINE_LINES, MIN_LINE_TOKENS, NATURALNESS_MODEL_ID,
    NATURALNESS_MODEL_VERSION, NATURALNESS_PREDICTION_ID, NATURALNESS_SCHEMA_VERSION, SURPRISAL_STEP, UNUSUAL_Z, naturalnessCollector, naturalnessLanguageOf, predictNaturalness,
    type NaturalnessBaselineFile, type NaturalnessChangedFile, type NaturalnessCollector, type NaturalnessInput, type NaturalnessLanguage,
    type NaturalnessResult, type UnusualLine,
} from './naturalness.js';
export {
    CHECK_COST, CHECK_EXPECTED_MS, CHECK_SCHEDULER_MODEL_ID, CHECK_SCHEDULER_MODEL_VERSION, COST_ARM_CONCENTRATION, DIMENSION_VALUE,
    EXPLORATION_SHARE, MIN_CHECK_OBSERVATIONS, PRIOR_STRENGTH, hasScheduleHistory, runThreshold, thompsonScheduler,
} from './scheduler.js';
export {
    EXPLORE_POLICY, THOMPSON_POLICY, cellDimensions, contextCell, dynamicCheckOutcomes, scheduleCellKey, scheduleHistoryOf, scheduleTelemetry,
    type BetaCount, type DynamicCheckOutcome, type ScheduleHistory, type ScheduleTelemetry,
} from './scheduleHistory.js';
export { decisiveDimensions } from './credit.js';
// WS21 (§D10): ranking and similar runs. D0: order and counts only — never a verdict.
export {
    FINDING_RANK_MODEL_ID, FINDING_RANK_MODEL_VERSION, FINDING_RANK_PREDICTION_ID, FINDING_RANK_SCHEMA_VERSION, FINDING_RANK_STEP,
    FINDING_RANK_WEIGHTS, findingRankFeatures, findingRankScore, findingRelevance, predictFindingRank, quantizeRankScore, rankFindings,
    rankNdcgAt5, type FindingRankFeatures, type FindingRankResult,
} from './ranking.js';
export {
    SIMILAR_RUNS_K, SIMILAR_RUNS_MIN_LABELLED, SIMILAR_RUNS_MODEL_ID, SIMILAR_RUNS_MODEL_VERSION, SIMILAR_RUNS_PREDICTION_ID,
    SIMILAR_RUNS_SCHEMA_VERSION, similarRuns, type SimilarRun, type SimilarRunOutcome, type SimilarRunsResult,
} from './similarRuns.js';
// Part D models (WS17): Bayesian rule precision (D3), calibration (D4), trend SPC (D7)
// and reliability growth (D8). All compose the builderforce-memory `stats` module (D13).
export {
    CREDIBLE_MASS, DEFAULT_ALPHA0, DEFAULT_BETA0, DEFAULT_PRIOR_STRENGTH, DEMOTE_BOUND, MIN_VOTES_TO_MOVE, RESTORE_BOUND,
    RULE_PRECISION_MODEL_ID,
    RULE_PRECISION_MODEL_VERSION, RULE_PRECISION_PREDICTION_ID, RULE_PRECISION_SCHEMA_VERSION, evaluateRulePrecision,
    predictRulePrecision, shrinkRepoPosterior, tallyRuleVotes, type RulePrecisionDecision, type RulePrecisionInput,
    type RulePrecisionPosterior, type RulePrecisionResult, type RuleVote,
} from './rulePrecision.js';
export {
    ECE_BINS, ECE_RECALIBRATE_THRESHOLD, ISOTONIC_MIN_EXAMPLES, RULE_CALIBRATION_MODEL_ID, RULE_CALIBRATION_MODEL_VERSION,
    RULE_CALIBRATION_PREDICTION_ID, RULE_CALIBRATION_SCHEMA_VERSION, calibrationPrediction, calibrateScores,
    type CalibrationExample, type CalibrationFit, type CalibrationMethod, type CalibrateScoresInput, type CalibrateScoresResult,
} from './calibration.js';
export {
    CHANGE_POINT_HAZARD, CUSUM_DRIFT, CUSUM_TARGET, CUSUM_THRESHOLD, METRIC_SPC_MODEL_ID, METRIC_SPC_MODEL_VERSION,
    METRIC_SPC_PREDICTION_ID, METRIC_SPC_SCHEMA_VERSION, SPC_MIN_HISTORY, detectTrendShift, spcPrediction,
    type SpcInput, type SpcResult, type SpcSignal,
} from './spc.js';
export {
    CHAPMAN_MIN_CAPTURED, GOEL_OKUMOTO_BOOTSTRAP_RESAMPLES, GOEL_OKUMOTO_MIN_POINTS, RELIABILITY_GROWTH_MODEL_ID,
    RELIABILITY_GROWTH_MODEL_VERSION, RELIABILITY_GROWTH_PREDICTION_ID, RELIABILITY_GROWTH_SCHEMA_VERSION,
    estimateReliabilityGrowth, estimateUndetected, reliabilityGrowthPrediction, type ReliabilityGrowthInput, type ReliabilityGrowthResult,
} from './reliabilityGrowth.js';
