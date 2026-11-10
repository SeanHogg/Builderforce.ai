/**
 * engine/noise.ts — the C6.2 reporting bar as the verdict reads it, with no statistics import (the engine's
 * worker bundle never loads the stats module for a delta without sampled metrics). A sampled metric (a
 * benchmark) counts only when p < {@link SIGNIFICANCE_ALPHA} AND its CI lies wholly beyond ±warn; anything else is
 * `same (within noise)`. The numbers themselves come from `dynamic/significance.ts`.
 */

import type { MetricDelta } from '../contract.js';

export const SIGNIFICANCE_ALPHA = 0.01;

/**
 * True when a metric carries a Wilcoxon significance that does NOT clear the C6.2 bar, or `method: 'none'` (too
 * few pairs, or a measurement problem such as a non-finite sample): the verdict treats it as `same (within noise)`.
 * A metric without `significance` (a deterministic count) is never "noise". `sprt-sign` (D9.2): an `accept` is noise;
 * a `reject` is a decided change that must STILL have its bootstrap CI wholly beyond ±warn — the guard against the
 * winner's curse of early stopping (the stop is chosen when the effect looks largest).
 */
export function withinNoise(m: Pick<MetricDelta, 'significance' | 'threshold'>): boolean {
    const s = m.significance;
    if (!s) return false;
    if (s.method === 'none') return true;
    if (s.method === 'sprt-sign') {
        if (s.decision !== 'reject' || !s.ci) return true;
    } else if (s.method !== 'wilcoxon-signed-rank') return false;
    else if (s.p === undefined || !(s.p < SIGNIFICANCE_ALPHA) || !s.ci) return true;
    const [lo, hi] = s.ci;
    return !(lo > m.threshold.warn || hi < -m.threshold.warn);
}
