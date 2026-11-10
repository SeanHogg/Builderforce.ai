/** The optional dynamic tier (PRD 41 C6.2, C8.4): pure contracts, policy, statistics wiring and parsers. */

export * from './contract.js';
export { isMandated, optInScheduler, planDynamicTier, dynamicPolicyOf, type DynamicPolicyResult } from './schedule.js';
export { pairedEffect, withinNoise, median, seedOf, SIGNIFICANCE_ALPHA, BOOTSTRAP_ITERATIONS, BOOTSTRAP_CONFIDENCE, type PairedEffect } from './significance.js';
export { benchmarkDelta, benchMetricId, BENCH_STEP, type PairedSamples } from './benchmarkMetric.js';
export { changedLines } from './changedLines.js';
export {
    sequentialBenchmarkDelta, sprtCap, sprtOperatingCharacteristics, sprtSign, sprtSignTest, sprtStops,
    SPRT_ALPHA, SPRT_BETA, SPRT_CAP_PAIRS, SPRT_MIN_REJECT_PAIRS, SPRT_P0, SPRT_P1,
    sprtAlphaBounds, sprtRealized,
    type SequentialBenchmarkTest, type SprtDirection, type SprtAlphaBounds, type SprtOperatingCharacteristics, type SprtRealized, type SprtSignDecision, type SprtSignResult,
} from './sprt.js';
export {
    diffCoverage, diffCoverageMetric, COVERAGE_DIFF_METRIC, COVERAGE_STEP, COVERAGE_THRESHOLD,
    type DiffCoverage, type DiffCoverageFile, type DiffCoverageFileResult, type LineHits,
} from './diffCoverage.js';
export { testTimingMeasurement, TEST_TIMING_RULE, SLOWER_FACTOR, SLOW_TEST_MS, type TestDurations } from './testTiming.js';
export {
    mutationMeasurement, parseMutationReport, MUTATION_RULE, MUTATION_STEP, MUTATION_THRESHOLD,
    type Mutant, type MutantStatus, type MutationReport,
} from './mutation.js';
export { annotateDynamicTier, dynamicNotRunReason, metricRuleId, withDynamicRules } from './fold.js';
export {
    runDynamicTier, DISCOVERED_BENCH_ROUNDS, type BenchmarkSamples, type DynamicRunners, type DynamicTierInput, type ReportOf, type RunnerOutcome,
} from './tier.js';
