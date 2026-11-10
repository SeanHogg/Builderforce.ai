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
] as const;

/** Memory's per-tool reasons: `<prefix>:<tool>`, rendered with `{tool}`. */
export const RUN_DELTA_TOOL_REASON_PREFIXES = ['tool-missing', 'tool-version-changed', 'analyzer-failed'] as const;

/** Headline clause codes that are neither a rule id, a reason nor `metric:<id>` (engine/headline.ts). */
export const RUN_DELTA_CLAUSE_CODES = ['findings-resolved', 'metrics-improved', 'worse'] as const;

/** `MetricDelta.metricId` values the built-in metric rules emit. */
export const RUN_DELTA_METRIC_IDS = ['complexity.max', 'complexity.sum', 'todo.added', 'any-cast.added'] as const;

/** `UnresolvedFile.reason`. */
export const RUN_DELTA_EXCLUDED_REASONS = [
    'preimage-too-large', 'preimage-missing', 'git-unavailable', 'changed-ignored', 'changed-outside-run', 'submodule-moved', 'binary',
] as const;
