/** The optional dynamic tier (PRD 41 C6.2, C8.4): pure contracts, policy, statistics wiring and parsers. */
export * from './contract.js';
export { isMandated, optInScheduler, planDynamicTier, dynamicPolicyOf } from './schedule.js';
export { pairedEffect, withinNoise, median, seedOf, SIGNIFICANCE_ALPHA, BOOTSTRAP_ITERATIONS, BOOTSTRAP_CONFIDENCE } from './significance.js';
export { benchmarkDelta, benchMetricId, BENCH_STEP } from './benchmarkMetric.js';
export { changedLines } from './changedLines.js';
export { sequentialBenchmarkDelta, sprtCap, sprtOperatingCharacteristics, sprtSign, sprtSignTest, sprtStops, SPRT_ALPHA, SPRT_BETA, SPRT_CAP_PAIRS, SPRT_MIN_REJECT_PAIRS, SPRT_P0, SPRT_P1, sprtAlphaBounds, sprtRealized, } from './sprt.js';
export { diffCoverage, diffCoverageMetric, COVERAGE_DIFF_METRIC, COVERAGE_STEP, COVERAGE_THRESHOLD, } from './diffCoverage.js';
export { testTimingMeasurement, TEST_TIMING_RULE, SLOWER_FACTOR, SLOW_TEST_MS } from './testTiming.js';
export { mutationMeasurement, parseMutationReport, MUTATION_RULE, MUTATION_STEP, MUTATION_THRESHOLD, } from './mutation.js';
export { annotateDynamicTier, dynamicNotRunReason, metricRuleId, withDynamicRules } from './fold.js';
export { runDynamicTier, DISCOVERED_BENCH_ROUNDS, } from './tier.js';
//# sourceMappingURL=index.js.map