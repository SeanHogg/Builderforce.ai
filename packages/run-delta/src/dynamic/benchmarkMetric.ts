/**
 * dynamic/benchmarkMetric.ts — one interleaved benchmark's samples as a {@link MetricDelta} (C6.2).
 *
 * `before` is the median of the before samples and `after` is that level moved by the PAIRED
 * Hodges–Lehmann effect, so the size the verdict reads (`metricLevels`) is the paired effect, not a
 * difference of two unpaired medians. Both are quantized integers of {@link BENCH_STEP} (B8.2). The
 * significance (dynamic/significance.ts) decides whether the move counts at all: within noise ⇒ `same`.
 */

import type { MetricDelta } from '../contract.js';
import type { BenchmarkSpec } from './contract.js';
import { pairedEffect } from './significance.js';

/** Value step: microseconds for `ms`, whole instructions for `instructions`. */
export const BENCH_STEP: Readonly<Record<BenchmarkSpec['unit'], number>> = { ms: 0.001, instructions: 1 };

/** Interleaved samples of one benchmark: `before[i]` and `after[i]` were measured back to back (one pair). */
export interface PairedSamples {
    before: readonly number[];
    after: readonly number[];
}

export const benchMetricId = (id: string): string => `bench.${id}`;

export function benchmarkDelta(spec: Pick<BenchmarkSpec, 'id' | 'unit' | 'threshold'>, samples: PairedSamples): MetricDelta {
    const metricId = benchMetricId(spec.id);
    const step = BENCH_STEP[spec.unit];
    const e = pairedEffect(samples.before, samples.after, spec.threshold, metricId);
    const q = (v: number): number => Math.round(v / step);
    return {
        metricId,
        before: e.n === 0 ? null : q(e.reference),
        after: e.n === 0 ? null : q(e.reference + e.effect),
        step,
        unit: spec.unit,
        betterWhen: 'lower',
        threshold: spec.threshold,
        significance: e.significance,
    };
}
