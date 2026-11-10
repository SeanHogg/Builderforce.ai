/**
 * dynamic/tier.ts — THE dynamic-tier run (C6.2, C8.4): plan (dynamic/schedule.ts), run each decided check
 * through the host's {@link DynamicRunners} port, and turn raw tool output into {@link DynamicCheckResult}s
 * with this package's pure statistics and parsers. Every check yields exactly one result — `ok`, `failed`
 * or `skipped` with its reason — so a dimension never reads a check that did not run as "no findings".
 *
 * No I/O of its own: processes, clocks and the before tree are the runners' (agent-tools
 * `delta/dynamic/*`, structurally typed there because agent-tools cannot import this package).
 */

import { benchmarkDelta, type PairedSamples } from './benchmarkMetric.js';
import {
    DEFAULT_BENCH_THRESHOLD, DYNAMIC_CHECKS, MIN_BENCH_PAIRS,
    type BenchmarkSpec, type DynamicCheckContext, type DynamicCheckId, type DynamicCheckResult, type DynamicCheckScheduler,
    type DynamicMeasurement, type DynamicPolicy, type DynamicScheduledBy, type DynamicSkipReason,
} from './contract.js';
import { mutationMeasurement, parseMutationReport } from './mutation.js';
import { optInScheduler, planDynamicTier } from './schedule.js';
import { sequentialBenchmarkDelta, sprtStops, type SequentialBenchmarkTest } from './sprt.js';
import { testTimingMeasurement, type TestDurations } from './testTiming.js';

/** A runner's outcome: its raw value, or why it broke (`timeout`, `exit-failed`, `no-report`, `aborted`, …). */
export type RunnerOutcome<T> =
    | { ok: true; tool: string; version: string; value: T }
    | { ok: false; tool: string; version: string; reason: string };

/**
 * One benchmark's interleaved samples (a configured spec, or one the runner discovered, e.g. a vitest `bench`,
 * which has no threshold of its own: {@link DEFAULT_BENCH_THRESHOLD}). `unit` is the one MEASURED (an
 * `instructions` spec measured where `perf` is unavailable reports `ms`).
 */
export interface BenchmarkSamples {
    spec: Pick<BenchmarkSpec, 'id' | 'unit'> & { threshold?: BenchmarkSpec['threshold'] };
    samples: PairedSamples;
    /**
     * `false`: the runner was handed the sequential test but the remaining budget could not afford its cap, so it ran
     * the spec's fixed rounds — the tier reports these samples by C6.2 and never reads the SPRT on them (D9.2).
     */
    sequential?: boolean;
}

/** Rounds and warm-ups for a discovered benchmark (a configured one carries its own). */
export const DISCOVERED_BENCH_ROUNDS = { rounds: MIN_BENCH_PAIRS, warmup: 1 } as const;

/** A tool's JSON report and the absolute tree it ran in (report paths are relativized against it). */
export interface ReportOf {
    json: unknown;
    root: string;
}

/** What a host runs. Every method is bounded by `signal` (the tier's budget, or the run's Stop). */
export interface DynamicRunners {
    /** Checks this host cannot run, and why — decided before any process starts. */
    availability(policy: DynamicPolicy, changedCode: readonly string[]): Promise<Partial<Record<DynamicCheckId, DynamicSkipReason>>>;
    /**
     * Interleaved before/after pairs of every configured benchmark (`policy.benchmarks`), or — none configured —
     * of the discovered ones (vitest `bench` files) at `discovered` rounds. With `sequential` (D9.2) the rounds run up
     * to its `cap(rounds)` instead, and stop once every benchmark's pairs are `decided` — when the remaining budget can
     * afford the cap (estimated from the measured rounds); otherwise the fixed rounds run.
     */
    benchmarks(
        specs: readonly BenchmarkSpec[], discovered: { rounds: number; warmup: number }, signal: AbortSignal,
        sequential?: SequentialBenchmarkTest,
    ): Promise<RunnerOutcome<BenchmarkSamples[]>>;
    /**
     * The tests related to the changed code, run on the after tree WITH coverage (leaving the report the L3
     * `coverage` analyzer reads) and on the before tree without; per-test durations of each side.
     */
    tests(changedCode: readonly string[], signal: AbortSignal): Promise<RunnerOutcome<{ before?: TestDurations; after: TestDurations }>>;
    /** StrykerJS incremental, mutating only `changedCode`, on each tree (`before` absent: no before tree). */
    mutation(changedCode: readonly string[], signal: AbortSignal): Promise<RunnerOutcome<{ before?: ReportOf; after: ReportOf }>>;
}

export interface DynamicTierInput {
    ctx: DynamicCheckContext;
    policy: DynamicPolicy;
    /** In-run changed CODE files (no tests, snapshots or docs), root-relative, sorted. */
    changedCode: readonly string[];
    runners: DynamicRunners;
    /** Default {@link optInScheduler}; WS20 passes its Thompson sampler. */
    scheduler?: DynamicCheckScheduler;
    /**
     * D9.2: benchmarks run as a sequential test (`sprtSignTest`) — stopped by Wald's rule, reported `sprt-sign`.
     * Absent: the fixed rounds of each spec, reported by C6.2's Wilcoxon test.
     */
    sequential?: SequentialBenchmarkTest;
    signal: AbortSignal;
}

const skippedResult = (check: DynamicCheckId, reason: string, by: DynamicScheduledBy): DynamicCheckResult =>
    ({ check, tool: '', version: '', status: 'skipped', reason, measurements: [], scheduledBy: by });

function resultOf<T>(
    check: DynamicCheckId, outcome: RunnerOutcome<T>, by: DynamicScheduledBy, measure: (value: T) => DynamicMeasurement[] | string,
): DynamicCheckResult {
    const base = { check, tool: outcome.tool, version: outcome.version, scheduledBy: by };
    if (!outcome.ok) return { ...base, status: 'failed', reason: outcome.reason, measurements: [] };
    const m = measure(outcome.value);
    return typeof m === 'string' ? { ...base, status: 'failed', reason: m, measurements: [] } : { ...base, status: 'ok', measurements: m };
}

/**
 * The benchmarks' metrics. Sequential (D9.2): a series Wald's rule stopped counts whatever its length and reports
 * `sprt-sign` (`sequentialBenchmarkDelta`); an unstopped one needs {@link MIN_BENCH_PAIRS} and reports Wilcoxon.
 */
function benchMeasurement(samples: readonly BenchmarkSamples[], sequential: boolean): DynamicMeasurement[] | string {
    if (samples.length === 0) return 'no-report';
    // A non-finite sample (NaN, ±Infinity from a broken timer or counter) is a measurement problem, never a pass.
    const finite = (xs: readonly number[]) => xs.every(Number.isFinite);
    if (samples.some((s) => !finite(s.samples.before) || !finite(s.samples.after))) return 'non-finite-samples';
    const thresholdOf = (s: BenchmarkSamples) => s.spec.threshold ?? DEFAULT_BENCH_THRESHOLD;
    const sequentialOf = (s: BenchmarkSamples): boolean => sequential && s.sequential !== false;
    const enough = (s: BenchmarkSamples): boolean => {
        const n = Math.min(s.samples.before.length, s.samples.after.length);
        return n >= MIN_BENCH_PAIRS || (sequentialOf(s) && sprtStops(s.samples, thresholdOf(s)));
    };
    const metrics = [...samples]
        .filter(enough)
        .map((s) => (sequentialOf(s) ? sequentialBenchmarkDelta : benchmarkDelta)({ ...s.spec, threshold: thresholdOf(s) }, s.samples))
        .sort((a, b) => (a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0));
    if (metrics.length === 0) return 'too-few-pairs';
    return [{ ruleId: 'bench', ruleVersion: 1, dimension: 'performance', findings: { before: [], after: [] }, metrics }];
}

async function runCheck(check: DynamicCheckId, input: DynamicTierInput, by: DynamicScheduledBy): Promise<DynamicCheckResult> {
    const { runners, changedCode, policy, signal } = input;
    if (signal.aborted) return { check, tool: '', version: '', status: 'failed', reason: 'aborted', measurements: [], scheduledBy: by };
    try {
        if (check === 'benchmark') {
            const { sequential } = input;
            const outcome = await (sequential
                ? runners.benchmarks(policy.benchmarks, DISCOVERED_BENCH_ROUNDS, signal, sequential)
                : runners.benchmarks(policy.benchmarks, DISCOVERED_BENCH_ROUNDS, signal));
            return resultOf(check, outcome, by, (v) => benchMeasurement(v, sequential !== undefined));
        }
        if (check === 'diff-coverage') {
            return resultOf(check, await runners.tests(changedCode, signal), by, (v) => (v.before ? [testTimingMeasurement(v.before, v.after)] : []));
        }
        return resultOf(check, await runners.mutation(changedCode, signal), by, (v) => {
            const after = parseMutationReport(v.after.json, v.after.root);
            if (!after) return 'invalid-report';
            const before = v.before ? parseMutationReport(v.before.json, v.before.root) : undefined;
            if (v.before && !before) return 'invalid-report';
            return [mutationMeasurement(after, before, changedCode)];
        });
    } catch {
        return { check, tool: '', version: '', status: 'failed', reason: signal.aborted ? 'aborted' : 'runner-threw', measurements: [], scheduledBy: by };
    }
}

/** Plans and runs the tier. One result per check, in {@link DYNAMIC_CHECKS} order; checks run one at a time (they contend for the CPU). */
export async function runDynamicTier(input: DynamicTierInput): Promise<DynamicCheckResult[]> {
    const unavailable = await input.runners.availability(input.policy, input.changedCode).catch(() => ({} as Partial<Record<DynamicCheckId, DynamicSkipReason>>));
    if (input.changedCode.length === 0) for (const c of ['diff-coverage', 'mutation'] as const) unavailable[c] ??= 'no-changed-code';
    const plan = planDynamicTier(input.ctx, input.policy, unavailable, input.scheduler ?? optInScheduler);
    const out: DynamicCheckResult[] = [];
    for (const check of DYNAMIC_CHECKS) {
        const d = plan.get(check)!;
        out.push(d.run ? await runCheck(check, input, d.scheduledBy) : skippedResult(check, d.reason ?? 'not-scheduled', d.scheduledBy));
    }
    return out;
}
