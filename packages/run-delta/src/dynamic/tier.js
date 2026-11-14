/**
 * dynamic/tier.ts — THE dynamic-tier run (C6.2, C8.4): plan (dynamic/schedule.ts), run each decided check
 * through the host's {@link DynamicRunners} port, and turn raw tool output into {@link DynamicCheckResult}s
 * with this package's pure statistics and parsers. Every check yields exactly one result — `ok`, `failed`
 * or `skipped` with its reason — so a dimension never reads a check that did not run as "no findings".
 *
 * No I/O of its own: processes, clocks and the before tree are the runners' (agent-tools
 * `delta/dynamic/*`, structurally typed there because agent-tools cannot import this package).
 */
import { benchmarkDelta } from './benchmarkMetric.js';
import { DEFAULT_BENCH_THRESHOLD, DYNAMIC_CHECKS, MIN_BENCH_PAIRS, } from './contract.js';
import { mutationMeasurement, parseMutationReport } from './mutation.js';
import { optInScheduler, planDynamicTier } from './schedule.js';
import { sequentialBenchmarkDelta, sprtStops } from './sprt.js';
import { testTimingMeasurement } from './testTiming.js';
/** Rounds and warm-ups for a discovered benchmark (a configured one carries its own). */
export const DISCOVERED_BENCH_ROUNDS = { rounds: MIN_BENCH_PAIRS, warmup: 1 };
const skippedResult = (check, reason, by) => ({ check, tool: '', version: '', status: 'skipped', reason, measurements: [], scheduledBy: by });
function resultOf(check, outcome, by, measure) {
    const base = { check, tool: outcome.tool, version: outcome.version, scheduledBy: by };
    if (!outcome.ok)
        return { ...base, status: 'failed', reason: outcome.reason, measurements: [] };
    const m = measure(outcome.value);
    return typeof m === 'string' ? { ...base, status: 'failed', reason: m, measurements: [] } : { ...base, status: 'ok', measurements: m };
}
/**
 * The benchmarks' metrics. Sequential (D9.2): a series Wald's rule stopped counts whatever its length and reports
 * `sprt-sign` (`sequentialBenchmarkDelta`); an unstopped one needs {@link MIN_BENCH_PAIRS} and reports Wilcoxon.
 */
function benchMeasurement(samples, sequential) {
    if (samples.length === 0)
        return 'no-report';
    // A non-finite sample (NaN, ±Infinity from a broken timer or counter) is a measurement problem, never a pass.
    const finite = (xs) => xs.every(Number.isFinite);
    if (samples.some((s) => !finite(s.samples.before) || !finite(s.samples.after)))
        return 'non-finite-samples';
    const thresholdOf = (s) => s.spec.threshold ?? DEFAULT_BENCH_THRESHOLD;
    const sequentialOf = (s) => sequential && s.sequential !== false;
    const enough = (s) => {
        const n = Math.min(s.samples.before.length, s.samples.after.length);
        return n >= MIN_BENCH_PAIRS || (sequentialOf(s) && sprtStops(s.samples, thresholdOf(s)));
    };
    const metrics = [...samples]
        .filter(enough)
        .map((s) => (sequentialOf(s) ? sequentialBenchmarkDelta : benchmarkDelta)({ ...s.spec, threshold: thresholdOf(s) }, s.samples))
        .sort((a, b) => (a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0));
    if (metrics.length === 0)
        return 'too-few-pairs';
    return [{ ruleId: 'bench', ruleVersion: 1, dimension: 'performance', findings: { before: [], after: [] }, metrics }];
}
async function runCheck(check, input, by) {
    const { runners, changedCode, policy, signal } = input;
    if (signal.aborted)
        return { check, tool: '', version: '', status: 'failed', reason: 'aborted', measurements: [], scheduledBy: by };
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
            if (!after)
                return 'invalid-report';
            const before = v.before ? parseMutationReport(v.before.json, v.before.root) : undefined;
            if (v.before && !before)
                return 'invalid-report';
            return [mutationMeasurement(after, before, changedCode)];
        });
    }
    catch {
        return { check, tool: '', version: '', status: 'failed', reason: signal.aborted ? 'aborted' : 'runner-threw', measurements: [], scheduledBy: by };
    }
}
/** Plans and runs the tier. One result per check, in {@link DYNAMIC_CHECKS} order; checks run one at a time (they contend for the CPU). */
export async function runDynamicTier(input) {
    const unavailable = await input.runners.availability(input.policy, input.changedCode).catch(() => ({}));
    if (input.changedCode.length === 0)
        for (const c of ['diff-coverage', 'mutation'])
            unavailable[c] ??= 'no-changed-code';
    const plan = planDynamicTier(input.ctx, input.policy, unavailable, input.scheduler ?? optInScheduler);
    const out = [];
    for (const check of DYNAMIC_CHECKS) {
        const d = plan.get(check);
        out.push(d.run ? await runCheck(check, input, d.scheduledBy) : skippedResult(check, d.reason ?? 'not-scheduled', d.scheduledBy));
    }
    return out;
}
//# sourceMappingURL=tier.js.map