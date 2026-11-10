/**
 * The non-rule codes the run delta engine can emit, kept next to the labels so a test can prove
 * every one has a label in every locale (`frontend/src/lib/knowledge/runDeltaCatalog.test.ts`).
 * Rule ids and dimensions come from the engine's own registries (`BUILT_IN_RULES`,
 * `ALL_DIMENSIONS`); these are string literals inside the engine and memory's `comparable()`,
 * so the same test greps those sources and fails when a new literal is missing here.
 */

/** Reasons on a dimension (`DimensionResult.reasons`), the blast radius, or a failed analyzer run. */
export const RUN_DELTA_REASON_CODES = [
    // engine/verdict.ts + engine/computeRunDelta.ts
    'static-only', 'rule-failed', 'rule-not-built', 'metric-not-measured', 'tests-weakened', 'heuristic',
    'not-comparable', 'before-unresolved', 'head-switched', 'rule-threw',
    // engine/blastRadius.ts
    'insufficient-history',
    // memory `comparable()` (PRD 41 §C9)
    'extractor-mismatch', 'extractor-version-changed', 'content-hash-rule-changed', 'scope-changed', 'repo-changed',
    'branch-changed', 'truncated',
    // An L3 analyzer run that did not measure (`MeasuredBy.reason`, agent-tools `delta/adapters`, the editor's analyzer tier).
    'tool-absent', 'analyzer-unavailable', 'timeout', 'exit-failed', 'invalid-report', 'no-coverage', 'before-tree-unavailable', 'analyzer-threw',
    'no-analyzer-host', 'untrusted-workspace', 'output-too-large', 'no-database', 'no-config', 'interrupted',
    // Why a dynamic-tier check did not run or did not land (`MeasuredBy.reason`; run-delta `dynamic/`, the editor's tier).
    'opt-in-off', 'not-scheduled', 'not-configured', 'tool-unavailable', 'no-changed-code', 'policy-never', 'no-shell',
    'aborted', 'runner-threw', 'too-few-pairs', 'no-report', 'recompute-failed',
    'budget-exhausted', 'tree-unavailable', 'non-finite-samples',
    // A static rule that cannot measure this run (`DeltaRule.applies` false; `MeasuredBy.reason`).
    'not-applicable', 'no-plan',
] as const;

/** Memory's per-tool reasons: `<prefix>:<tool>`, rendered with `{tool}`. */
export const RUN_DELTA_TOOL_REASON_PREFIXES = ['tool-missing', 'tool-version-changed', 'analyzer-failed', 'analyzer-not-measured', 'dynamic-not-run', 'analyzer-pending', 'analyzer-data-stale'] as const;

/**
 * The dynamic tier's own rule ids (run-delta `dynamic/`): its checks (`benchmark`, `diff-coverage`, `mutation`, the
 * subject of `dynamic-not-run:<check>` and of a failed check's `analyzer-failed:<check>`) and the rules its measurements
 * register (`test-slower`, `mutant-survived`, `<rule>.metrics`). Labelled under `rules`.
 */
export const RUN_DELTA_DYNAMIC_RULE_IDS = [
    'benchmark', 'diff-coverage', 'mutation', 'bench.metrics', 'test-slower', 'mutant-survived', 'mutant-survived.metrics',
] as const;

/** Headline clause codes that are neither a rule id, a reason nor `metric:<id>` (engine/headline.ts). */
export const RUN_DELTA_CLAUSE_CODES = ['findings-resolved', 'metrics-improved', 'worse'] as const;

/** `MetricDelta.metricId` values the built-in metric rules emit. */
export const RUN_DELTA_METRIC_IDS = ['complexity.max', 'complexity.sum', 'todo.added', 'any-cast.added', 'coverage.diff', 'coupling.efferent', 'mutation.score', 'coupling.afferent', 'coupling.instability', 'hotspot.touched'] as const;

/** `UnresolvedFile.reason`. */
export const RUN_DELTA_EXCLUDED_REASONS = [
    'preimage-too-large', 'preimage-missing', 'git-unavailable', 'changed-ignored', 'changed-outside-run', 'submodule-moved', 'binary',
] as const;
