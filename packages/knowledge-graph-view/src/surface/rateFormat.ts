/**
 * THE ONE formatter for a rate or a prediction on screen (PRD 38 "Display"): every rate shows its n and its interval.
 *
 * - An observation (`low`/`high` present: a co-change confidence, a trace hop) reads "x% (a–b) · n = N", and
 *   "≈ x% (a–b) · n = N" under {@link FEW_SAMPLES}. x is memory's shrunk rate (the Beta posterior mean under its
 *   `RATE_PRIOR`), so a 1-of-1 never reads as 100%.
 * - A reference-row hop (no interval) is not an observed rate: it reads as a share of references, "k of n references".
 *
 * The view computes no prediction here: the interval is memory's, the point estimate is memory's `betaPosterior`.
 */

import { betaPosterior, RATE_PRIOR } from '@seanhogg/builderforce-memory/stats';
import { fillTemplate, type KnowledgeGraphLabels } from '../labels';

/** Below this many observations a rate is marked ≈. */
export const FEW_SAMPLES = 10;

/** k of n, with the interval when it is an observation (absent on a reference-weight share). */
export interface RateCount {
    k: number;
    n: number;
    low?: number | undefined;
    high?: number | undefined;
}

const pct = (v: number): number => Math.round(v * 100);
const count = (v: number): string => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

export function rateFormat(labels: KnowledgeGraphLabels, { k, n, low, high }: RateCount): string {
    const t = labels.surface.predict;
    if (low === undefined || high === undefined) return fillTemplate(t.share, { k: count(k), n: count(n) });
    const x = pct(betaPosterior(RATE_PRIOR, RATE_PRIOR, k, n).mean);
    return fillTemplate(n < FEW_SAMPLES ? t.rateFew : t.rate, { x, low: pct(low), high: pct(high), n: count(n) });
}
