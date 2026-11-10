/**
 * The host runners of the run delta's optional dynamic tier (PRD 41 C6.2, C8.4): interleaved benchmarks, the
 * related tests with coverage, StrykerJS incremental — through the L3 `AnalyzerExec` process seam, in scratch COPIES
 * of both sides only. No node builtins here: the host makes the copies (the VSIX's `runDelta/analyzers/beforeTree.ts`
 * in `copy` mode) and hands them in through {@link DynamicHost.tree}.
 */

export { changedCodeOf, type DynamicHost } from './host.js';
export { dynamicRunners } from './runners.js';
export { COVERAGE_DIR } from './testRunner.js';
export { benchValues, testDurations } from './vitestReports.js';
export type {
  BenchSamplesLike, BenchSpecLike, DynamicCheckIdLike, DynamicRunnersLike, Outcome as DynamicOutcomeLike, ReportLike, SkipReasonLike, ThresholdLike,
} from './runnerTypes.js';
