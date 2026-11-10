import { describe, expect, it } from 'vitest';
import type { DimensionId, RunDelta } from '../contract.js';
import { computeRunDelta } from '../engine/computeRunDelta.js';
import { digestOf } from '../engine/digest.js';
import { metricLevels } from '../engine/verdict.js';
import { withOverrides } from '../registry/overrides.js';
import { DEFAULT_REGISTRIES } from '../registry/defaults.js';
import { defaultDimensionRegistry } from '../registry/dimensions.js';
import { fixture } from '../testing/fixturePorts.js';
import { benchmarkDelta } from './benchmarkMetric.js';
import { changedLines } from './changedLines.js';
import { DEFAULT_BENCH_THRESHOLD, DEFAULT_DYNAMIC_POLICY, type DynamicCheckContext, type DynamicCheckResult } from './contract.js';
import { diffCoverage, diffCoverageMetric } from './diffCoverage.js';
import { annotateDynamicTier, withDynamicRules } from './fold.js';
import { mutationMeasurement, parseMutationReport } from './mutation.js';
import { dynamicPolicyOf, planDynamicTier } from './schedule.js';
import { createRng } from '@seanhogg/builderforce-memory/stats';
import { pairedEffect, withinNoise } from './significance.js';
import { testTimingMeasurement } from './testTiming.js';
import { runDynamicTier, type DynamicRunners } from './tier.js';

const dim = (d: RunDelta, id: DimensionId) => d.dimensions.find((x) => x.id === id)!;

/**
 * 20 interleaved pairs around 100 ms; `after` shifted by `shift` ms. Each side draws its OWN uniform noise of
 * ±`noise`/2 ms from an independent seeded stream (memory `createRng`), so the pair differences genuinely vary in
 * sign and size — the same numbers on every machine.
 */
function pairs(shift: number, noise: number): { before: number[]; after: number[] } {
    const rb = createRng(11), ra = createRng(29);
    const before = Array.from({ length: 20 }, () => 100 + noise * (rb() - 0.5));
    const after = Array.from({ length: 20 }, () => 100 + shift + noise * (ra() - 0.5));
    return { before, after };
}

/** Exact two-sided Wilcoxon p when all n differences share one sign: 2 / 2ⁿ. */
const ALL_ONE_SIGN_P20 = 2 / 2 ** 20;

const ctx: DynamicCheckContext = {
    runId: 'run-1', mode: 'interactive', changedFiles: ['src/a.ts'], dimensionsTouched: [],
    blastRadius: { score: 0, band: 'low' }, inputDigest: 'd', optIn: false, trusted: true, remainingBudgetMs: 60_000,
};

const benchResult = (shift: number, noise: number): DynamicCheckResult => ({
    check: 'benchmark', tool: 'command', version: '', status: 'ok', scheduledBy: { policy: 'opt-in' },
    measurements: [{
        ruleId: 'bench', ruleVersion: 1, dimension: 'performance', findings: { before: [], after: [] },
        metrics: [benchmarkDelta({ id: 'parse', unit: 'ms', threshold: DEFAULT_BENCH_THRESHOLD }, pairs(shift, noise))],
    }],
});

async function deltaWith(results: DynamicCheckResult[]): Promise<RunDelta> {
    const { input, ports } = fixture({ 'src/a.ts': 'export const a = 1;\n' }, { 'src/a.ts': 'export const a = 2;\n' });
    const delta = await computeRunDelta(input, withDynamicRules(defaultDimensionRegistry(), results), ports);
    return annotateDynamicTier(delta, results);
}

describe('benchmarks: Wilcoxon signed-rank wiring (C6.2)', () => {
    it('a significant 20% regression makes performance worse, with p and a CI beyond the threshold', async () => {
        const r = benchResult(20, 4);
        const m = r.measurements[0]!.metrics[0]!;
        expect(m.significance?.method).toBe('wilcoxon-signed-rank');
        // Every difference is 20 ± 4 ms > 0: the exact null distribution gives p = 2/2^20.
        expect(m.significance!.p!).toBeCloseTo(ALL_ONE_SIGN_P20, 12);
        expect(m.significance!.ci![0]).toBeGreaterThan(0.05);
        expect(withinNoise(m)).toBe(false);
        expect(metricLevels(m).regression).toBe('error');
        const d = await deltaWith([r]);
        expect(dim(d, 'performance').verdict).toBe('worse');
        expect(dim(d, 'performance').reasons).not.toContain('static-only');
        expect(d.summary.clauses.find((c) => c.dimension === 'performance')?.code).toBe('metric:bench.parse');
    });

    it('noise (no shift, wide spread) is the same: not significant, within noise, never a regression', async () => {
        const r = benchResult(0, 30);
        const m = r.measurements[0]!.metrics[0]!;
        const p = pairs(0, 30);
        const signs = p.after.map((a, i) => Math.sign(a - p.before[i]!));
        expect(signs.filter((s) => s > 0).length).toBeGreaterThan(4); // genuinely mixed signs: real noise
        expect(signs.filter((s) => s < 0).length).toBeGreaterThan(4);
        expect(m.significance!.p!).toBeGreaterThan(0.05);
        expect(m.significance!.ci![0]).toBeLessThan(0);
        expect(m.significance!.ci![1]).toBeGreaterThan(0);
        expect(withinNoise(m)).toBe(true);
        expect(metricLevels(m)).toEqual({ regression: undefined, improvement: undefined });
        expect(dim(await deltaWith([r]), 'performance').verdict).toBe('same');
    });

    it('a significant but tiny shift (CI inside ±5%) is still the same', () => {
        const m = benchResult(1, 0.2).measurements[0]!.metrics[0]!;
        // 1 ± 0.2 ms > 0 for every pair: exactly significant, yet the HL CI (≈ ±1%) sits inside ±5%.
        expect(m.significance!.p!).toBeCloseTo(ALL_ONE_SIGN_P20, 12);
        expect(m.significance!.ci![1]).toBeLessThan(0.05);
        expect(withinNoise(m)).toBe(true);
    });

    it('pins the estimator: one outlier pair moves neither the Hodges–Lehmann effect nor its CI (a mean would)', () => {
        const before = Array.from({ length: 20 }, () => 100);
        const after = [...Array.from({ length: 19 }, () => 101), 600];
        const e = pairedEffect(before, after, DEFAULT_BENCH_THRESHOLD, 'outlier');
        expect(e.effect).toBeCloseTo(1, 9);
        expect(e.significance.ci![1]).toBeLessThan(0.05);
        expect(withinNoise({ significance: e.significance, threshold: DEFAULT_BENCH_THRESHOLD })).toBe(true);
    });

    it('a non-finite sample is a measurement problem: the check fails `non-finite-samples`, never a pass', async () => {
        const nan = pairs(20, 4);
        nan.after[3] = Number.NaN;
        expect(pairedEffect(nan.before, nan.after, DEFAULT_BENCH_THRESHOLD, 'k')).toMatchObject({ nonFinite: 1, significance: { method: 'none' } });
        const runners: DynamicRunners = {
            availability: async () => ({}),
            benchmarks: async () => ({ ok: true, tool: 'command', version: '', value: [{ spec: { id: 'p', unit: 'ms' }, samples: nan }] }),
            tests: async () => ({ ok: false, tool: 'vitest', version: '', reason: 'unused' }),
            mutation: async () => ({ ok: false, tool: 'stryker', version: '', reason: 'unused' }),
        };
        const results = await runDynamicTier({ ctx: { ...ctx, optIn: true, trusted: true }, policy: DEFAULT_DYNAMIC_POLICY, changedCode: [], runners, signal: new AbortController().signal });
        expect(results[0]).toMatchObject({ check: 'benchmark', status: 'failed', reason: 'non-finite-samples' });
    });

    it('a significant 20% improvement makes performance better', async () => {
        expect(dim(await deltaWith([benchResult(-20, 4)]), 'performance').verdict).toBe('better');
    });

    it('is deterministic: the same samples give the same metric and digest', async () => {
        const [a, b] = [await deltaWith([benchResult(20, 4)]), await deltaWith([benchResult(20, 4)])];
        expect(a.digest).toBe(b.digest);
        expect(digestOf(a)).toBe(a.digest);
    });
});

describe('opt-in off: the dimension says the dynamic tier did not run (never zero)', () => {
    it('plans every optional check as skipped `opt-in-off`, and the delta carries the reasons and skipped rows', async () => {
        const runners: DynamicRunners = {
            availability: async () => ({}),
            benchmarks: async () => { throw new Error('must not run'); },
            tests: async () => { throw new Error('must not run'); },
            mutation: async () => { throw new Error('must not run'); },
        };
        const policy = { ...DEFAULT_DYNAMIC_POLICY, benchmarks: [{ id: 'p', command: 'node b.js', unit: 'ms' as const, threshold: DEFAULT_BENCH_THRESHOLD, rounds: 10, warmup: 1 }] };
        const results = await runDynamicTier({ ctx, policy, changedCode: ['src/a.ts'], runners, signal: new AbortController().signal });
        expect(results.map((r) => [r.check, r.status, r.reason])).toEqual([
            ['benchmark', 'skipped', 'opt-in-off'], ['diff-coverage', 'skipped', 'opt-in-off'], ['mutation', 'skipped', 'opt-in-off'],
        ]);
        const d = await deltaWith(results);
        const perf = dim(d, 'performance');
        expect(perf.reasons).toEqual(expect.arrayContaining(['static-only', 'dynamic-not-run:benchmark']));
        expect(perf.measuredBy).toContainEqual({ tool: 'benchmark', version: '', status: 'skipped', reason: 'opt-in-off' });
        expect(dim(d, 'quality').reasons).toEqual(expect.arrayContaining(['dynamic-not-run:diff-coverage', 'dynamic-not-run:mutation']));
        expect(perf.metrics).toEqual([]);
        // D9.1: who decided, persisted on the delta and covered by its digest.
        expect(d.dynamic).toEqual([
            { check: 'benchmark', status: 'skipped', reason: 'opt-in-off', tool: '', version: '', scheduledBy: { policy: 'opt-in' } },
            { check: 'diff-coverage', status: 'skipped', reason: 'opt-in-off', tool: '', version: '', scheduledBy: { policy: 'opt-in' } },
            { check: 'mutation', status: 'skipped', reason: 'opt-in-off', tool: '', version: '', scheduledBy: { policy: 'opt-in' } },
        ]);
        const sampled = results.map((r) => ({ ...r, scheduledBy: { policy: 'thompson', p: 0.25, seed: 7 } }));
        expect((await deltaWith(sampled)).digest).not.toBe(d.digest);
    });

    it('an untrusted workspace runs nothing, mandated checks included, and says so', () => {
        const policy = { ...DEFAULT_DYNAMIC_POLICY, require: { benchmark: 'always' as const, 'diff-coverage': 'always' as const, mutation: 'always' as const } };
        const plan = planDynamicTier({ ...ctx, optIn: true, trusted: false }, policy, {});
        for (const c of ['benchmark', 'diff-coverage', 'mutation'] as const) {
            expect(plan.get(c)).toEqual({ run: false, reason: 'untrusted-workspace', scheduledBy: { policy: 'trust' } });
        }
        expect(planDynamicTier({ ...ctx, optIn: true, remainingBudgetMs: 0 }, policy, {}).get('mutation')).toMatchObject({ run: false, reason: 'budget-exhausted' });
        expect(planDynamicTier({ ...ctx, optIn: true }, policy, { mutation: 'tool-unavailable' }).get('mutation'))
            .toEqual({ run: false, reason: 'tool-unavailable', scheduledBy: { policy: 'unavailable' } });
    });

    it('a policy-mandated check runs although opt-in is off; `never` never runs', () => {
        const policy = { ...DEFAULT_DYNAMIC_POLICY, require: { benchmark: 'never' as const, 'diff-coverage': 'always' as const, mutation: 'autonomous-protected' as const } };
        const plan = planDynamicTier({ ...ctx, mode: 'autonomous', branch: 'main' }, policy, {});
        expect(plan.get('benchmark')).toMatchObject({ run: false, reason: 'policy-never' });
        expect(plan.get('diff-coverage')).toMatchObject({ run: true, scheduledBy: { policy: 'mandated' } });
        expect(plan.get('mutation')).toMatchObject({ run: true, scheduledBy: { policy: 'mandated' } });
        expect(planDynamicTier({ ...ctx, mode: 'autonomous', branch: 'feature' }, policy, {}).get('mutation')).toMatchObject({ run: false, reason: 'opt-in-off' });
    });

    it('a failed check makes its dimension not_comparable with the real reason on its measuredBy row', async () => {
        const failed: DynamicCheckResult = { check: 'mutation', tool: 'stryker', version: '8.7.1', status: 'failed', reason: 'timeout', measurements: [], scheduledBy: { policy: 'opt-in' } };
        const q = dim(await deltaWith([failed]), 'quality');
        expect(q.verdict).toBe('not_comparable');
        expect(q.reasons).toContain('analyzer-failed:mutation');
        expect(q.measuredBy).toContainEqual({ tool: 'mutation', version: '8.7.1', status: 'failed', reason: 'timeout' });
    });
});

describe('policy data (.builderforce/delta.json, before side)', () => {
    it('parses benchmarks and requirements, drops invalid entries as codes, and withOverrides accepts the keys', () => {
        const raw = {
            benchmarks: [{ id: 'parse', command: 'node bench/parse.js', rounds: 12 }, { id: 'bad id!', command: 'x' }],
            dynamic: { require: { mutation: 'autonomous', nope: 'always' }, protectedBranches: ['release'], typo: 1 },
        };
        const { policy, dropped } = dynamicPolicyOf(raw);
        expect(policy.benchmarks).toEqual([{ id: 'parse', command: 'node bench/parse.js', unit: 'ms', threshold: DEFAULT_BENCH_THRESHOLD, rounds: 12, warmup: 1 }]);
        expect(policy.require.mutation).toBe('autonomous');
        expect(policy.protectedBranches).toEqual(['release']);
        expect(dropped).toEqual(['invalid:benchmarks.1', 'invalid:dynamic.require.nope', 'unknown-key:dynamic.typo']);
        expect(withOverrides(DEFAULT_REGISTRIES, raw).dropped).toEqual([]);
    });
});

describe('diff coverage on a fixture lcov (C8.4)', () => {
    it('counts only the changed, instrumented lines', () => {
        const before = 'a\nb\nc\n';
        const after = 'a\nB\nc\nd\n// note\n';
        expect(changedLines(before, after)).toEqual([2, 4, 5]);
        // lcov DA lines for src/a.ts: 1 hit, 2 hit, 4 missed (line 5 is a comment: not instrumented).
        const hits = new Map([['src/a.ts', new Map([[1, true], [2, true], [3, true], [4, false]])]]);
        const d = diffCoverage([{ path: 'src/a.ts', before, after }], hits);
        expect(d).toEqual({ covered: 1, total: 2, files: [{ path: 'src/a.ts', covered: 1, total: 2, uncovered: [4] }] });
        expect(diffCoverageMetric([{ path: 'src/a.ts', before, after }], hits)).toMatchObject({ metricId: 'coverage.diff', value: 5000, step: 0.0001, betterWhen: 'higher' });
        expect(diffCoverageMetric([{ path: 'src/b.ts', after }], hits)).toBeUndefined();
    });
});

describe('StrykerJS report parsing (C8.4)', () => {
    const report = (statuses: string[], version = '8.7.1') => ({
        schemaVersion: '1', framework: { name: 'StrykerJS', version },
        files: {
            'C:/repo/src/a.ts': {
                language: 'typescript', source: 'export const f = (x) => x > 1;\nexport const g = 2;\n',
                mutants: statuses.map((status, i) => ({ id: String(i), mutatorName: i % 2 ? 'EqualityOperator' : 'ConditionalExpression', replacement: `r${i}`, status, location: { start: { line: 1, column: 1 }, end: { line: 1, column: 5 } } })),
            },
            'C:/repo/src/other.ts': { language: 'typescript', mutants: [{ id: 'x', mutatorName: 'BlockStatement', replacement: '{}', status: 'Survived', location: { start: { line: 3, column: 1 } } }] },
        },
    });

    it('relativizes paths, reads statuses and the framework version; rejects a non-report', () => {
        const r = parseMutationReport(report(['Killed', 'Survived', 'NoCoverage', 'CompileError']), 'C:/repo')!;
        expect(r.version).toBe('8.7.1');
        expect(r.mutants.map((m) => [m.path, m.status])).toEqual([
            ['src/a.ts', 'Killed'], ['src/a.ts', 'Survived'], ['src/a.ts', 'NoCoverage'], ['src/a.ts', 'CompileError'], ['src/other.ts', 'Survived'],
        ]);
        expect(r.mutants[0]!.lineText).toBe('export const f = (x) => x > 1;');
        expect(parseMutationReport({ nope: 1 })).toBeUndefined();
    });

    it('scores the changed files only, and survivors get lineage: an old survivor persists, a new one is introduced', () => {
        const before = parseMutationReport(report(['Killed', 'Survived', 'Killed', 'Killed']), 'C:/repo')!;
        const after = parseMutationReport(report(['Killed', 'Survived', 'NoCoverage', 'Timeout']), 'C:/repo')!;
        const m = mutationMeasurement(after, before, ['src/a.ts']);
        expect(m.metrics[0]).toMatchObject({ metricId: 'mutation.score', before: 7500, after: 5000, betterWhen: 'higher' });
        expect(m.findings.before).toHaveLength(1);
        expect(m.findings.after.map((f) => f.params.status)).toEqual(['NoCoverage', 'Survived']);
        // The same surviving mutant on both sides has one identity (lineage: persisting); the new one does not.
        expect(m.findings.after[1]!.identity.id).toBe(m.findings.before[0]!.identity.id);
        expect(m.findings.after.every((f) => f.severity === 'info' && f.confidence === 'measured')).toBe(true);
    });
});

describe('test timing (C6.2 proxy)', () => {
    it('warns on a test 3x slower and over 200 ms only', () => {
        const before = new Map([['a.test.ts#slow', 100], ['a.test.ts#fast', 10], ['a.test.ts#gone', 5]]);
        const after = new Map([['a.test.ts#slow', 450], ['a.test.ts#fast', 150], ['a.test.ts#new', 900]]);
        const m = testTimingMeasurement(before, after);
        expect(m.findings.after.map((f) => f.params)).toEqual([{ test: 'slow', beforeMs: 100, afterMs: 450 }]);
        expect(m.dimension).toBe('performance');
    });
});
