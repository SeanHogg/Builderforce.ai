/**
 * dynamic/significance.ts — C6.2 reporting for interleaved benchmark pairs, on the ONE statistics home
 * (`@seanhogg/builderforce-memory/stats`; nothing here re-implements a test):
 *
 *  - the test is the Wilcoxon signed-rank test on the pair differences (`wilcoxonSignedRank`);
 *  - the effect is its paired Hodges–Lehmann estimate, with a seeded paired-bootstrap 95% CI OF THAT SAME
 *    ESTIMATOR (`pairedBootstrapCi(…, { statistic: 'hodges-lehmann' })`, seeded from the metric id so the same
 *    samples give the same CI everywhere);
 *  - a change is REPORTED only when p < α AND the CI lies wholly beyond the warn threshold (default ±5%) —
 *    `withinNoise` (engine/noise.ts) is what the verdict reads, so a noisy metric never moves a dimension;
 *  - a pair with a non-finite value (`WilcoxonResult.nonFinite`) is a MEASUREMENT problem, never a pass: the effect
 *    is `method: 'none'` and {@link PairedEffect.nonFinite} says why (the tier fails the check `non-finite-samples`).
 *
 * `ci` is stored in the THRESHOLD's units: a fraction of the before median for `pct`, metric units for `abs`.
 */

import { pairedBootstrapCi, wilcoxonSignedRank } from '@seanhogg/builderforce-memory/stats';
import { sha256Hex } from '@seanhogg/builderforce-memory/retrieval';
import type { MetricDelta } from '../contract.js';

export { SIGNIFICANCE_ALPHA, withinNoise } from '../engine/noise.js';
export const BOOTSTRAP_ITERATIONS = 2_000;
export const BOOTSTRAP_CONFIDENCE = 0.95;

export interface PairedEffect {
    /** Number of pairs used. */
    n: number;
    /** Pairs with a non-finite value (a measurement problem: the effect is then `method: 'none'`). */
    nonFinite: number;
    /** Median of the before samples (the reference level). */
    reference: number;
    /** Paired Hodges–Lehmann estimate of `after − before`, in metric units. */
    effect: number;
    significance: NonNullable<MetricDelta['significance']>;
}

/** A deterministic 32-bit seed from a stable key (the metric id). */
export const seedOf = (key: string): number => Number.parseInt(sha256Hex(key).slice(0, 8), 16);

export function median(xs: readonly number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * The paired effect of `after` over `before` (index i of each is one interleaved pair). The CI is expressed
 * in `threshold.kind` units. Fewer than two pairs, or any non-finite pair: `method: 'none'` (never significant).
 */
export function pairedEffect(
    before: readonly number[], after: readonly number[], threshold: MetricDelta['threshold'], seedKey: string,
): PairedEffect {
    const n = Math.min(before.length, after.length);
    const b = before.slice(0, n), a = after.slice(0, n);
    const ownNonFinite = b.reduce((c, v, i) => c + (Number.isFinite(v) && Number.isFinite(a[i]!) ? 0 : 1), 0);
    const reference = median(b.filter(Number.isFinite));
    if (n < 2 || ownNonFinite > 0) return { n, nonFinite: ownNonFinite, reference, effect: 0, significance: { method: 'none' } };
    const w = wilcoxonSignedRank(b, a);
    if (w.nonFinite > 0) return { n, nonFinite: w.nonFinite, reference, effect: 0, significance: { method: 'none' } };
    // The bootstrap of the SAME estimator the effect reports (memory ≥ 2026.10.74).
    const boot = pairedBootstrapCi(b, a, {
        iterations: BOOTSTRAP_ITERATIONS, confidence: BOOTSTRAP_CONFIDENCE, seed: seedOf(seedKey), statistic: 'hodges-lehmann',
    });
    const scale = threshold.kind === 'pct' ? (reference === 0 ? 0 : 1 / Math.abs(reference)) : 1;
    const ci: [number, number] = [boot.low * scale, boot.high * scale];
    return { n, nonFinite: 0, reference, effect: w.hodgesLehmann, significance: { method: 'wilcoxon-signed-rank', p: w.pValue, ci } };
}
