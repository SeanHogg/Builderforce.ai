/**
 * dynamic/contract.ts — the OPTIONAL dynamic tier of the run delta (PRD 41 C6.2, C8.4): interleaved
 * benchmarks, diff coverage and incremental mutation testing. Pure types, no I/O.
 *
 * The tier never runs by default (§9): a check runs when the project's policy MANDATES it (C11 item 4, the delta policy; C8.4), or when
 * the {@link DynamicCheckScheduler} decides to — today the person's opt-in setting
 * ({@link optInScheduler}), from WS20 the contextual Thompson sampler (D9.1), which implements the same
 * interface. The host runs each decided check (process exec, timers — never in this package) and hands
 * back a {@link DynamicCheckResult}; `withDynamicRules` (dynamic/fold.ts) registers the results as
 * ordinary registry rules, so lineage, comparability and the verdicts treat them like any other rule.
 *
 * Why rules and not the L3 `DeltaPorts.analyze` port: an analyzer result is ONE side's output, while a
 * benchmark is a set of interleaved PAIRS (its significance exists only jointly) and a per-test slowdown
 * compares both sides. The `diff-coverage` check is the exception by design: it RUNS the tests with
 * coverage (and yields their per-test timings); the `coverage.diff` metric itself is the L3 `coverage`
 * analyzer's, over the report that run leaves (`diffCoverageMetric`).
 *
 * A check that did not run is never zero findings: its dimension carries `dynamic-not-run:<check>` and a
 * `skipped` `MeasuredBy` row whose reason says why (`annotateDynamicTier`).
 */
export const DYNAMIC_CHECKS = ['benchmark', 'diff-coverage', 'mutation'];
/** The dimension each check measures. */
export const DYNAMIC_CHECK_DIMENSION = {
    benchmark: 'performance',
    'diff-coverage': 'quality',
    mutation: 'quality',
};
export const MIN_BENCH_PAIRS = 10;
export const DEFAULT_BENCH_THRESHOLD = { warn: 0.05, error: 0.05, kind: 'pct' };
export const DEFAULT_DYNAMIC_BUDGET_MS = 15 * 60_000;
export const DEFAULT_DYNAMIC_POLICY = {
    require: { benchmark: 'optional', 'diff-coverage': 'optional', mutation: 'optional' },
    protectedBranches: ['main', 'master'],
    benchmarks: [],
    budgetMs: DEFAULT_DYNAMIC_BUDGET_MS,
};
//# sourceMappingURL=contract.js.map