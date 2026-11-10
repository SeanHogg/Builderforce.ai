import { describe, expect, it } from 'vitest';
import { metricLevels } from '../engine/verdict.js';
import type { PairedSamples } from './benchmarkMetric.js';
import { DEFAULT_BENCH_THRESHOLD, DEFAULT_DYNAMIC_POLICY, type DynamicCheckContext } from './contract.js';
import { withinNoise } from './significance.js';
import {
    sequentialBenchmarkDelta, sprtAlphaBounds, sprtCap, sprtOperatingCharacteristics, sprtRealized, sprtSign, sprtSignTest,
    SPRT_CAP_PAIRS, SPRT_MIN_REJECT_PAIRS, SPRT_P1, type SequentialBenchmarkTest, type SprtRealized,
} from './sprt.js';

/** Pinned fixtures of the exact DP (π₁ 0.85, α 0.01, β 0.05), for the caps in use: every spec of ≤ 30 rounds, and 60. */
const SPRT_REALIZED_BY_CAP: Readonly<Record<30 | 60, SprtRealized>> = {
    30: { alpha: 0.0075, beta: 0.1066, asnH0: 15.62, asnH1: 16.62, unresolvedH0: 0.0482 },
    60: { alpha: 0.0081, beta: 0.0343, asnH0: 16.09, asnH1: 17.28, unresolvedH0: 0.0014 },
};
const SPRT_REALIZED = SPRT_REALIZED_BY_CAP[30];
/** At cap 30: rigorous 0.0075 + min(0.0482, 0.01) = 0.0175; under independence 0.0075 + 0.0482 × 0.01 ≈ 0.0080. */
const SPRT_ALPHA_BOUNDS = { rigorous: 0.0175, independent: 0.008 };
import { runDynamicTier, type DynamicRunners } from './tier.js';

/** A deterministic jitter in [-0.5, 0.5): the same noise on every machine. */
const jitter = (i: number): number => (((i * 7919) % 101) / 101) - 0.5;

/** Round `i` of a fixture: ~100 ms before, after = 100 × factor(i), each with ±`noise` ms. */
type Factor = number | ((i: number) => number);
const pairAt = (i: number, factor: Factor, noise: number): [number, number] =>
    [100 + noise * jitter(i), 100 * (typeof factor === 'number' ? factor : factor(i)) + noise * jitter(i + 37)];

/** What the runner does with a sequential test: one pair per round until decided, up to the cap. */
function runSequential(test: SequentialBenchmarkTest, factor: Factor, noise: number, rounds = 10): PairedSamples {
    const before: number[] = [];
    const after: number[] = [];
    for (let i = 0; i < test.cap(rounds); i++) {
        if (test.decided({ id: 'p' }, { before, after })) break;
        const [b, a] = pairAt(i, factor, noise);
        before.push(b);
        after.push(a);
    }
    return { before, after };
}

const SPRT = sprtSignTest(DEFAULT_BENCH_THRESHOLD);
const spec = { id: 'p', unit: 'ms' as const, threshold: DEFAULT_BENCH_THRESHOLD };
const alternating = (i: number) => (i % 2 === 0 ? 1.1 : 0.9);

describe('sign-test SPRT (D9.2 done-check)', () => {
    it('stops early on a 20% regression, at an even round, reported sprt-sign / reject with its CI', () => {
        const samples = runSequential(SPRT, 1.2, 2);
        const n = samples.before.length;
        expect(n).toBeLessThan(SPRT_CAP_PAIRS);
        expect(n % 2).toBe(0);
        expect(n).toBeGreaterThanOrEqual(SPRT_MIN_REJECT_PAIRS);
        expect(sprtSign(samples, DEFAULT_BENCH_THRESHOLD).decision).toBe('regressed');
        const m = sequentialBenchmarkDelta(spec, samples);
        expect(m.significance).toMatchObject({ method: 'sprt-sign', decision: 'reject' });
        expect(m.significance!.ci![0]).toBeGreaterThan(DEFAULT_BENCH_THRESHOLD.warn);
        expect(withinNoise(m)).toBe(false);
        expect(metricLevels(m).regression).toBe('error');
    });

    it('runs to the maximum on a no-change fixture (every pair a tie), then reports Wilcoxon', () => {
        const samples = runSequential(SPRT, 1, 2); // ±1% noise: every pair is within ±δ/2
        expect(samples.before.length).toBe(SPRT_CAP_PAIRS);
        expect(sprtSign(samples, DEFAULT_BENCH_THRESHOLD)).toMatchObject({ decision: 'continue', observations: 0 });
        const m = sequentialBenchmarkDelta(spec, samples);
        expect(m.significance?.method).toBe('wilcoxon-signed-rank');
        expect(withinNoise(m)).toBe(true);
    });

    it('the mirrored test stops early on a 20% improvement', () => {
        const samples = runSequential(SPRT, 0.8, 2);
        expect(samples.before.length).toBeLessThan(SPRT_CAP_PAIRS);
        expect(sprtSign(samples, DEFAULT_BENCH_THRESHOLD).decision).toBe('improved');
    });

    it('the recorded realized rates are the exact DP\'s, and the minimum is the boundaries\'', () => {
        const q = (v: number, step: number) => Math.round(v / step) * step;
        const h0 = sprtOperatingCharacteristics(0.5);
        const h1 = sprtOperatingCharacteristics(SPRT_P1);
        expect(q(h0.regressed, 1e-4)).toBeCloseTo(SPRT_REALIZED.alpha, 10);
        expect(q(1 - h1.regressed, 1e-4)).toBeCloseTo(SPRT_REALIZED.beta, 10);
        expect(q(h0.averagePairs, 1e-2)).toBeCloseTo(SPRT_REALIZED.asnH0, 10);
        expect(q(h1.averagePairs, 1e-2)).toBeCloseTo(SPRT_REALIZED.asnH1, 10);
        expect(q(h0.unresolved, 1e-4)).toBeCloseTo(SPRT_REALIZED.unresolvedH0, 10);
        expect(h0.regressed + h0.improved + h0.accepted + h0.unresolved).toBeCloseTo(1, 12);
        expect(h0.regressed).toBeCloseTo(h0.improved, 12); // symmetric under H₀
        const bounds = sprtAlphaBounds(SPRT_REALIZED);
        expect(bounds.rigorous).toBeCloseTo(SPRT_ALPHA_BOUNDS.rigorous, 10); // 0.0075 + min(0.0482, 0.01)
        expect(bounds.independent).toBeCloseTo(SPRT_ALPHA_BOUNDS.independent, 3); // 0.0075 + 0.0482 × 0.01
        expect(SPRT_MIN_REJECT_PAIRS).toBe(9);
    });
});

describe('regression: H1 — the SPRT never costs more rounds than it must, nor cuts a spec short', () => {
    it('regression: a noisy no-change (signs beyond δ/2 both ways) accepts in both directions and stops early as noise', () => {
        const samples = runSequential(SPRT, alternating, 0);
        expect(samples.before.length).toBeLessThan(SPRT_CAP_PAIRS);
        expect(sprtSign(samples, DEFAULT_BENCH_THRESHOLD)).toMatchObject({ decision: 'accept', slower: 'accept', faster: 'accept' });
        const m = sequentialBenchmarkDelta(spec, samples);
        expect(m.significance).toMatchObject({ method: 'sprt-sign', decision: 'accept' });
        expect(withinNoise(m)).toBe(true);
    });

    it('regression: the cap is max(30, spec rounds) — a 60-round spec keeps 60', () => {
        expect(sprtCap(10)).toBe(30);
        expect(sprtCap(60)).toBe(60);
        expect(runSequential(SPRT, 1, 2, 60).before.length).toBe(60);
    });

    it('regression: never stops at an odd round', () => {
        const samples = runSequential(SPRT, 1.2, 2);
        for (let n = 1; n < samples.before.length; n += 2) {
            expect(SPRT.decided({ id: 'p' }, { before: samples.before.slice(0, n), after: samples.after.slice(0, n) })).toBe(false);
        }
    });
});

describe('regression: M1 — an SPRT rejection still needs its CI beyond ±warn (winner\'s curse)', () => {
    it('regression: a consistent 3% slowdown rejects H₀ but stays within noise against a 5% warn', () => {
        const samples = runSequential(SPRT, 1.03, 0);
        expect(sprtSign(samples, DEFAULT_BENCH_THRESHOLD).decision).toBe('regressed');
        const m = sequentialBenchmarkDelta(spec, samples);
        expect(m.significance).toMatchObject({ method: 'sprt-sign', decision: 'reject' });
        expect(m.significance!.ci).toBeDefined();
        expect(withinNoise(m)).toBe(true);
        expect(metricLevels(m).regression).toBeUndefined();
    });
});

describe('the tier with a sequential test', () => {
    const ctx: DynamicCheckContext = {
        runId: 'run-1', mode: 'interactive', changedFiles: ['src/a.ts'], dimensionsTouched: [],
        blastRadius: { score: 0, band: 'low' }, inputDigest: 'd', optIn: true, trusted: true, remainingBudgetMs: 60_000,
    };

    it('hands the test to the runner, and reports a stopped series as sprt-sign', async () => {
        let handed: SequentialBenchmarkTest | undefined;
        const samples = runSequential(SPRT, 1.2, 2);
        const runners: DynamicRunners = {
            availability: async () => ({ 'diff-coverage': 'tool-unavailable', mutation: 'tool-unavailable' }),
            benchmarks: async (_specs, _discovered, _signal, sequential) => {
                handed = sequential;
                return { ok: true, tool: 'command', version: '', value: [{ spec: { id: 'p', unit: 'ms' }, samples }] };
            },
            tests: async () => { throw new Error('must not run'); },
            mutation: async () => { throw new Error('must not run'); },
        };
        const policy = { ...DEFAULT_DYNAMIC_POLICY, benchmarks: [{ id: 'p', command: 'node b.js', unit: 'ms' as const, threshold: DEFAULT_BENCH_THRESHOLD, rounds: 10, warmup: 1 }] };
        const [bench] = await runDynamicTier({ ctx, policy, changedCode: ['src/a.ts'], runners, sequential: SPRT, signal: new AbortController().signal });
        expect(handed).toBe(SPRT);
        expect(bench).toMatchObject({ check: 'benchmark', status: 'ok' });
        expect(bench!.measurements[0]!.metrics[0]!.significance).toMatchObject({ method: 'sprt-sign', decision: 'reject' });
    });
});

describe('L4 — an SPRT direction that disagrees with the Hodges–Lehmann effect falls back to C6.2', () => {
    it('regression: small slowdowns just beyond δ/2 reject "slower", but ties and a big speedup make the HL effect negative', () => {
        const before: number[] = [];
        const after: number[] = [];
        const push = (n: number, factor: number) => { for (let i = 0; i < n; i++) { before.push(100); after.push(100 * factor); } };
        push(12, 1.026); // slower by 2.6% > δ/2 = 2.5%: twelve "slower" signs
        push(31, 0.976); // faster by 2.4%: ties, dropped by the sign test, kept by Hodges–Lehmann
        push(1, 0.4);    // one large speedup
        const samples = { before, after };
        expect(samples.before.length % 2).toBe(0);
        expect(sprtSign(samples, DEFAULT_BENCH_THRESHOLD).decision).toBe('regressed');
        const m = sequentialBenchmarkDelta(spec, samples);
        expect(m.after!).toBeLessThan(m.before!); // the paired effect says faster
        expect(m.significance?.method).toBe('wilcoxon-signed-rank');
    });
});

describe('operating characteristics for each cap in use', () => {
    it('the recorded 30- and 60-pair rows are the exact DP results; another cap is computed on demand', () => {
        const q = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(4));
        for (const cap of [30, 60] as const) {
            const h0 = sprtOperatingCharacteristics(0.5, cap);
            const h1 = sprtOperatingCharacteristics(SPRT_P1, cap);
            expect(SPRT_REALIZED_BY_CAP[cap]).toEqual({
                alpha: q(h0.regressed, 1e-4), beta: q(1 - h1.regressed, 1e-4),
                asnH0: q(h0.averagePairs, 1e-2), asnH1: q(h1.averagePairs, 1e-2), unresolvedH0: q(h0.unresolved, 1e-4),
            });
        }
        expect(sprtRealized(30)).toEqual(SPRT_REALIZED_BY_CAP[30]);
        expect(sprtRealized(60)).toEqual(SPRT_REALIZED_BY_CAP[60]);
        expect(sprtRealized(60)).toBe(sprtRealized(60)); // memoised per cap
        const at40 = sprtRealized(40);
        expect(at40.beta).toBeLessThan(SPRT_REALIZED_BY_CAP[30].beta);
        expect(at40.beta).toBeGreaterThan(SPRT_REALIZED_BY_CAP[60].beta);
    });
});

describe('regression: the budget-gate fallback is never read as an SPRT', () => {
    it('regression: fixed-round samples the runner marks sequential: false report Wilcoxon, even when the SPRT would have stopped', async () => {
        const samples = runSequential(SPRT, 1.2, 2);
        expect(sprtSign(samples, DEFAULT_BENCH_THRESHOLD).decision).toBe('regressed');
        const ctx: DynamicCheckContext = {
            runId: 'run-1', mode: 'interactive', changedFiles: ['src/a.ts'], dimensionsTouched: [],
            blastRadius: { score: 0, band: 'low' }, inputDigest: 'd', optIn: true, trusted: true, remainingBudgetMs: 60_000,
        };
        const runners: DynamicRunners = {
            availability: async () => ({ 'diff-coverage': 'tool-unavailable', mutation: 'tool-unavailable' }),
            benchmarks: async () => ({ ok: true, tool: 'command', version: '', value: [{ spec: { id: 'p', unit: 'ms' }, samples, sequential: false }] }),
            tests: async () => { throw new Error('must not run'); },
            mutation: async () => { throw new Error('must not run'); },
        };
        const policy = { ...DEFAULT_DYNAMIC_POLICY, benchmarks: [{ id: 'p', command: 'node b.js', unit: 'ms' as const, threshold: DEFAULT_BENCH_THRESHOLD, rounds: 10, warmup: 1 }] };
        const [bench] = await runDynamicTier({ ctx, policy, changedCode: ['src/a.ts'], runners, sequential: SPRT, signal: new AbortController().signal });
        expect(bench!.measurements[0]!.metrics[0]!.significance?.method).toBe('wilcoxon-signed-rank');
    });
});

describe('the rates are read for the cap actually used', () => {
    it('cap 45 (a 45-round spec) is computed by the DP, quantized, and its bounds follow', () => {
        expect(sprtCap(45)).toBe(45);
        const q = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(4));
        const h0 = sprtOperatingCharacteristics(0.5, 45);
        const h1 = sprtOperatingCharacteristics(SPRT_P1, 45);
        const r = sprtRealized(sprtCap(45));
        expect(r).toEqual({
            alpha: q(h0.regressed, 1e-4), beta: q(1 - h1.regressed, 1e-4),
            asnH0: q(h0.averagePairs, 1e-2), asnH1: q(h1.averagePairs, 1e-2), unresolvedH0: q(h0.unresolved, 1e-4),
        });
        expect(r.beta).toBeLessThan(SPRT_REALIZED_BY_CAP[30].beta);
        expect(r.beta).toBeGreaterThan(SPRT_REALIZED_BY_CAP[60].beta);
        expect(sprtAlphaBounds(r).rigorous).toBeCloseTo(r.alpha + Math.min(r.unresolvedH0, 0.01), 12);
    });
});
