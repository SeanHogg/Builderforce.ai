/**
 * predict/reliabilityGrowth.ts — §D8 reliability growth: is the debt really going down?
 * Fits a Goel–Okumoto NHPP to the cumulative count of a dimension's introduced findings over
 * run index t (μ(t) = a(1 − e^(−bt))), and estimates the undetected remainder with the
 * Chapman capture–recapture estimator. This puts numbers on PRD 38's headline "debt goes
 * down".
 *
 * THE maths (the Goel–Okumoto MLE, the seeded bootstrap CI, the Chapman estimate) lives in the
 * builderforce-memory `stats` module (§D13); this file composes it and never re-implements
 * it. Pure and deterministic: the bootstrap CI draws from a PRNG seeded by the caller, so the
 * same inputs give byte-identical outputs on any machine. Advisory only (§D0).
 */

import {
    chapmanEstimate,
    createRng,
    goelOkumotoMLE,
    type InsufficientData,
} from '@seanhogg/builderforce-memory/stats';
import type { Prediction } from './prediction.js';

/** `dimension.reliability-growth` — the prediction id of the reliability-growth model. */
export const RELIABILITY_GROWTH_PREDICTION_ID = 'dimension.reliability-growth';
export const RELIABILITY_GROWTH_MODEL_ID = 'reliability.growth';
export const RELIABILITY_GROWTH_MODEL_VERSION = '1.0.0';
/** Bumped when the fit, the bootstrap or the Chapman inputs change. */
export const RELIABILITY_GROWTH_SCHEMA_VERSION = 1;

/** §D8: the Goel–Okumoto fit is shown only when there are at least this many points. */
export const GOEL_OKUMOTO_MIN_POINTS = 10;
/** §D8: 95% CI from a seeded bootstrap with this many resamples. */
export const GOEL_OKUMOTO_BOOTSTRAP_RESAMPLES = 1000;
/** The capture–recapture lists need at least this many distinct findings each (§D3/D8). */
export const CHAPMAN_MIN_CAPTURED = 3;

export interface ReliabilityGrowthInput {
    /**
     * The number of a dimension's introduced findings on each run, oldest first (one entry
     * per run, ≥ 0). The Goel–Okumoto MLE fits occurrence times, so these per-run counts are
     * reduced to inter-arrival times before fitting (a run with k findings contributes k
     * evenly-spaced occurrence times inside that run's unit interval).
     */
    introducedPerRun: readonly number[];
    /**
     * The seed for the bootstrap CI (§D8). The same seed and inputs give byte-identical
     * outputs on any machine.
     */
    seed: number;
    /** The kill switch off ⇒ `model-disabled`. */
    disabled?: boolean;
}

export interface ReliabilityGrowthResult {
    status: Prediction['status'];
    /** The number of cumulative points the fit ran on. */
    n: number;
    /**
     * The fitted Goel–Okumoto parameters. Absent when the fit did not converge, there were
     * fewer than {@link GOEL_OKUMOTO_MIN_POINTS} points, or `b ≤ 0` — then the process is not
     * "growing reliability" and the result is `not-applicable`.
     */
    fit: { a: number; b: number; remaining: number } | undefined;
    /**
     * The seeded-bootstrap 95% CI on the total expected failures `a` (2.5% and 97.5%
     * quantiles of the resampled MLE). Present only when the fit is.
     */
    aInterval: [number, number] | undefined;
}

/**
 * Reduce per-run introduced counts to the inter-arrival occurrence times the Goel–Okumoto
 * MLE fits: each run occupies a unit interval [t, t+1); its k findings are placed at the
 * midpoints of k equal sub-intervals. Deterministic.
 */
function occurrenceTimes(introducedPerRun: readonly number[]): number[] {
    const times: number[] = [];
    for (let t = 0; t < introducedPerRun.length; t++) {
        const k = introducedPerRun[t]!;
        for (let j = 1; j <= k; j++) times.push(t + j / (k + 1));
    }
    return times;
}

/**
 * Fit the Goel–Okumoto NHPP to the per-run introduced counts (via their occurrence times)
 * and derive the remaining-debt estimate a − μ(t). Shown only when the fit converges, there
 * are at least {@link GOEL_OKUMOTO_MIN_POINTS} runs and `b > 0`; otherwise `not-applicable`
 * or `insufficient-data` (§D8).
 */
export function estimateReliabilityGrowth(input: ReliabilityGrowthInput): ReliabilityGrowthResult {
    if (input.disabled) {
        return { status: 'model-disabled', n: input.introducedPerRun.length, fit: undefined, aInterval: undefined };
    }
    const n = input.introducedPerRun.length;
    if (n < GOEL_OKUMOTO_MIN_POINTS) {
        return { status: 'insufficient-data', n, fit: undefined, aInterval: undefined };
    }
    const times = occurrenceTimes(input.introducedPerRun);
    if (times.length < 2) {
        // Fewer than two total findings: nothing to fit a failure process to.
        return { status: 'insufficient-data', n, fit: undefined, aInterval: undefined };
    }
    const fitted = goelOkumotoMLE(times);
    if ('status' in fitted && fitted.status === 'insufficient-data') {
        return { status: 'insufficient-data', n, fit: undefined, aInterval: undefined };
    }
    const { a, b } = fitted as { a: number; b: number };
    // A degenerate (saturated) fit — b runs to the search bound, meaning the MLE found no
    // finite decay — is not a "reliability growth" process. Treat it as not-applicable
    // rather than reporting a meaningless μ(t).
    const saturated = b >= 1e5;
    if (!(b > 0) || !Number.isFinite(a) || saturated) {
        return { status: 'not-applicable', n, fit: undefined, aInterval: undefined };
    }
    const tMax = times[times.length - 1]!;
    const mu = a * (1 - Math.exp(-b * tMax));
    const fit = { a, b, remaining: Math.max(0, a - mu) };
    return { status: 'ok', n, fit, aInterval: bootstrapAInterval(times, input.seed) };
}

/**
 * The seeded-bootstrap 95% CI on `a`: resample the cumulative series with replacement from a
 * PRNG seeded by `seed`, refit the MLE on each resample, and take the 2.5% and 97.5%
 * quantiles. Deterministic under `seed`.
 */
function bootstrapAInterval(times: readonly number[], seed: number): [number, number] {
    const rng = createRng(seed);
    const n = times.length;
    const estimates: number[] = [];
    for (let r = 0; r < GOEL_OKUMOTO_BOOTSTRAP_RESAMPLES; r++) {
        const resampled: number[] = [];
        for (let i = 0; i < n; i++) resampled.push(times[Math.floor(rng() * n)]!);
        const fit = goelOkumotoMLE(resampled);
        if (!('status' in fit)) estimates.push(fit.a);
    }
    if (estimates.length === 0) return [0, 0];
    estimates.sort((x, y) => x - y);
    const lo = estimates[Math.floor(0.025 * (estimates.length - 1))]!;
    const hi = estimates[Math.floor(0.975 * (estimates.length - 1))]!;
    return [lo, hi];
}

/**
 * The Chapman capture–recapture estimate of the undetected findings in a dimension: `m`
 * findings from the first capture (e.g. the static tier), `c` from the second (e.g. the
 * dynamic tier), `r` seen by both. `m < 3` (or `c < 3`, or `r < 1`) gives `insufficient-data`
 * — never a guess.
 */
export function estimateUndetected(
    capturedM: number,
    capturedC: number,
    recapturedR: number,
): { estimate: number } | InsufficientData {
    if (capturedM < CHAPMAN_MIN_CAPTURED || capturedC < CHAPMAN_MIN_CAPTURED) {
        return { status: 'insufficient-data' };
    }
    return chapmanEstimate(capturedM, capturedC, recapturedR);
}

const quantize = (v: number): number => Math.round(v * 1000) / 1000;

/** THE `Prediction` shape (§D0.2): the value is the remaining-debt estimate, quantized. */
export function reliabilityGrowthPrediction(
    input: ReliabilityGrowthInput,
    result: ReliabilityGrowthResult,
): Prediction {
    const digest = `reliability-growth:v${RELIABILITY_GROWTH_SCHEMA_VERSION}:${result.n}n:${input.seed}:${result.fit?.a.toFixed(6) ?? 'none'}/${result.fit?.b.toFixed(6) ?? 'none'}`;    return {
        id: RELIABILITY_GROWTH_PREDICTION_ID,
        modelId: RELIABILITY_GROWTH_MODEL_ID,
        modelVersion: RELIABILITY_GROWTH_MODEL_VERSION,
        featureSchemaVersion: RELIABILITY_GROWTH_SCHEMA_VERSION,
        value: result.status === 'ok' && result.fit ? quantize(result.fit.remaining) : 0,
        interval: result.status === 'ok' && result.aInterval ? [quantize(result.aInterval[0]), quantize(result.aInterval[1])] : undefined,
        explanation:
            result.status === 'ok' && result.fit
                ? [
                      { feature: 'growth.expectedTotal', contribution: quantize(result.fit.a) },
                      { feature: 'growth.decay', contribution: quantize(result.fit.b) },
                      { feature: 'growth.remaining', contribution: quantize(result.fit.remaining) },
                  ]
                : [],
        status: result.status,
        inputDigest: digest,
    };
}
