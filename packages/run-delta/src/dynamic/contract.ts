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

import type { DimensionId, MetricDelta, RuleFinding } from '../contract.js';

/** The three dynamic checks. */
export type DynamicCheckId = 'benchmark' | 'diff-coverage' | 'mutation';

export const DYNAMIC_CHECKS: readonly DynamicCheckId[] = ['benchmark', 'diff-coverage', 'mutation'];

/** The dimension each check measures. */
export const DYNAMIC_CHECK_DIMENSION: Readonly<Record<DynamicCheckId, DimensionId>> = {
    benchmark: 'performance',
    'diff-coverage': 'quality',
    mutation: 'quality',
};

/**
 * Why a check is not run, as a stable code (localized at render):
 *  - `opt-in-off`: optional, and the person has not opted in (the default);
 *  - `not-scheduled`: optional, opted in or not, and the scheduler chose not to (WS20);
 *  - `not-configured`: no benchmark config / no vitest bench files / no coverage-capable runner;
 *  - `tool-unavailable`: the tool (vitest, StrykerJS, perf) is not installed in the workspace;
 *  - `no-changed-code`: no changed file the check applies to;
 *  - `policy-never`: the project's policy turns the check off;
 *  - `untrusted-workspace`: the workspace is not trusted, so no project code runs — mandated checks included; the
 *    dimension says so (never a silent pass);
 *  - `budget-exhausted`: the run's total dynamic-tier allowance is used up (the host caps it per run).
 *
 * A check that RAN and broke is `failed` with its own code instead (`tree-unavailable` when a scratch copy could not be
 * made, `no-shell`, `timeout`, `exit-failed`, `no-report`, `invalid-report`, `too-few-pairs`, `non-finite-samples`,
 * `aborted`, `runner-threw`).
 */
export type DynamicSkipReason =
    | 'opt-in-off'
    | 'not-scheduled'
    | 'not-configured'
    | 'tool-unavailable'
    | 'no-changed-code'
    | 'policy-never'
    | 'untrusted-workspace'
    | 'budget-exhausted';

/**
 * One rule's worth of a check's output: registered as a rule `<ruleId>` of `dimension` (`dynamic/fold.ts`).
 * One check may measure several rules (the coverage run also yields per-test timings for performance).
 */
export interface DynamicMeasurement {
    /** Stable rule id (`bench`, `test-slower`, `mutant-survived`); its metrics register as `<ruleId>.metrics`. */
    ruleId: string;
    /** Bumped when the measurement's meaning changes (comparability across stored deltas). */
    ruleVersion: number;
    dimension: DimensionId;
    /** Findings per side, before lineage (the engine computes lineage). */
    findings: { before: RuleFinding[]; after: RuleFinding[] };
    /** Metric deltas (benchmarks carry `significance`). */
    metrics: MetricDelta[];
}

/** What a host reports for one check: measured (`ok`), broken (`failed`, ⇒ `not_comparable`), or not run (`skipped`). */
export interface DynamicCheckResult {
    check: DynamicCheckId;
    /** The concrete tool (`command`, `vitest-bench`, `vitest`, `stryker`) and its version (`''` when unknown). */
    tool: string;
    version: string;
    status: 'ok' | 'failed' | 'skipped';
    /** For `skipped` a {@link DynamicSkipReason}; for `failed` a short code (see {@link DynamicSkipReason}'s note). */
    reason?: string;
    /** Empty unless `ok`. */
    measurements: DynamicMeasurement[];
    /** How the check came to run or not (D9.1 `scheduledBy`). */
    scheduledBy: DynamicScheduledBy;
}

/**
 * The record of a scheduling decision (D9.1), persisted on the delta (`RunDelta.dynamic`, in its digest): `policy`
 * names who decided — `mandated`, `opt-in`, `project-policy` (`never`), `unavailable` (not offered to a scheduler),
 * `trust` (untrusted workspace), `budget`, or a scheduler's own name (WS20); `p` and `seed` are the sampler's.
 */
export interface DynamicScheduledBy {
    policy: 'mandated' | 'opt-in' | 'project-policy' | 'unavailable' | 'trust' | 'budget' | string;
    /** The sampler's model (D9.1, D12 audit): `check-scheduler.beta-cell` and its version. */
    modelId?: string;
    modelVersion?: string;
    p?: number;
    seed?: number;
    /** On an exploration decision: what the sampler alone would have decided (§10 recall against random). */
    wouldRun?: boolean;
}

// ─── Policy (per-project data) ───────────────────────────────────────────────

/**
 * When a check is MANDATED regardless of the person's setting:
 *  - `optional` (default): never mandated; the scheduler decides;
 *  - `autonomous`: mandated on autonomous runs;
 *  - `autonomous-protected`: mandated on autonomous runs whose branch is in {@link DynamicPolicy.protectedBranches};
 *  - `always`: mandated on every run;
 *  - `never`: never run, even when opted in.
 */
export type DynamicRequirement = 'optional' | 'autonomous' | 'autonomous-protected' | 'always' | 'never';

/** A configured benchmark (`.builderforce/delta.json → benchmarks`, read from the BEFORE side). */
export interface BenchmarkSpec {
    /** Stable id: the metric is `bench.<id>`. */
    id: string;
    /** The command, run in each tree's root. */
    command: string;
    /** `ms` (wall time) or `instructions` (`perf stat`, Linux only; falls back to `ms` elsewhere). */
    unit: 'ms' | 'instructions';
    /** Relative (`pct`) regression thresholds; default {@link DEFAULT_BENCH_THRESHOLD}. */
    threshold: MetricDelta['threshold'];
    /** Interleaved pairs, at least {@link MIN_BENCH_PAIRS}. */
    rounds: number;
    /** Unmeasured warm-up runs per side before the first pair. */
    warmup: number;
}

export interface DynamicPolicy {
    require: Readonly<Record<DynamicCheckId, DynamicRequirement>>;
    protectedBranches: readonly string[];
    benchmarks: readonly BenchmarkSpec[];
    /** A run's whole dynamic tier is cut off after this many milliseconds (each check gets what is left). */
    budgetMs: number;
}

export const MIN_BENCH_PAIRS = 10;
export const DEFAULT_BENCH_THRESHOLD: MetricDelta['threshold'] = { warn: 0.05, error: 0.05, kind: 'pct' };
export const DEFAULT_DYNAMIC_BUDGET_MS = 15 * 60_000;

export const DEFAULT_DYNAMIC_POLICY: DynamicPolicy = {
    require: { benchmark: 'optional', 'diff-coverage': 'optional', mutation: 'optional' },
    protectedBranches: ['main', 'master'],
    benchmarks: [],
    budgetMs: DEFAULT_DYNAMIC_BUDGET_MS,
};

// ─── The scheduler seam (D9, WS20) ───────────────────────────────────────────

/** What a scheduler sees about a run. Everything is known before any dynamic check runs. */
export interface DynamicCheckContext {
    runId: string;
    mode: 'interactive' | 'autonomous';
    /** The branch the run finalizes on (absent: not a git repository, or detached). */
    branch?: string;
    /** In-run changed files, root-relative POSIX, sorted. */
    changedFiles: readonly string[];
    /** Dimensions the static delta did not call `same` (D9.1 "dimensions touched"). */
    dimensionsTouched: readonly DimensionId[];
    /** The static delta's blast radius. */
    blastRadius: { score: number; band: 'low' | 'medium' | 'high' };
    /** D5 run risk when a model exists (0..1); absent below its data threshold. */
    risk?: number;
    /** The static delta's digest: the PRNG seed source, so a sampled choice is reproducible (D9.1). */
    inputDigest: string;
    /** The person's opt-in (VSIX `builderforce.runDelta.dynamicTier`, a machine-scoped setting). */
    optIn: boolean;
    /** The workspace is trusted (VS Code workspace trust): false ⇒ no project code runs, mandated or not. */
    trusted: boolean;
    /** What the tier may still spend (ms), after the host's per-repository and per-run caps. */
    remainingBudgetMs: number;
}

export interface DynamicDecision {
    run: boolean;
    /** Why not, when `run` is false (`opt-in-off`, `not-scheduled`). */
    reason?: DynamicSkipReason;
    scheduledBy: DynamicScheduledBy;
    /**
     * What the check is expected to take (ms) when it runs — a scheduler's estimate. `planDynamicTier` charges it against
     * the budget the later checks see, so decisions are cumulative (absent: charged nothing).
     */
    expectedMs?: number;
}

/**
 * THE seam WS20 plugs into. Asked only for an OPTIONAL check that is available (configured, tool present,
 * changed code to measure): mandated checks always run and `never` checks never do, without asking.
 * Pure and deterministic under `ctx.inputDigest`.
 */
export interface DynamicCheckScheduler {
    decide(check: DynamicCheckId, ctx: DynamicCheckContext): DynamicDecision;
    /**
     * What a check is expected to take (ms) when it runs, however it came to run: `planDynamicTier` charges every run
     * decision — mandated, opt-in or sampled — against the budget the later checks are asked with. Absent: nothing charged
     * (unless the decision carries its own `expectedMs`).
     */
    expectedMs?(check: DynamicCheckId): number;
}
