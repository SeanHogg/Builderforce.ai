/**
 * predict/spc.ts — §D7 statistical process control over a per-metric run series (the trend
 * view, C11.3): complexity, duplication, the share of runs with integrity findings, introduced
 * security errors per run, and so on. Combines a CUSUM (Page) detector for slow drift with a
 * Bayesian online change-point (Adams & MacKay, 2007) that marks the run where the regime
 * changed, with its posterior probability.
 *
 * THE maths (CUSUM and the change-point posterior) lives in the builderforce-memory `stats`
 * module (§D13); this file composes it and never re-implements it. Pure and deterministic:
 * no I/O, no clock, no randomness. A signal is a trend annotation, not a verdict (§D7).
 */

import {
    bayesianOnlineChangePoint,
    cusum,
    type ChangePointResult,
    type CusumResult,
} from '@seanhogg/builderforce-memory/stats';
import type { Prediction } from './prediction.js';

/** `metric.spc` — the prediction id of the trend SPC model. */
export const METRIC_SPC_PREDICTION_ID = 'metric.spc';
export const METRIC_SPC_MODEL_ID = 'metric.spc';
export const METRIC_SPC_MODEL_VERSION = '1.0.0';
/** Bumped when the detector parameters or the minimum-history rule change. */
export const METRIC_SPC_SCHEMA_VERSION = 1;

/** §D7: each detector needs at least this many runs of history. */
export const SPC_MIN_HISTORY = 20;
/** §D7: the CUSUM reference level is the in-control mean `mu`. */
export const CUSUM_TARGET = 0;
/** §D7: CUSUM allowance `k = 0.5σ` (as a multiple of `sigma`). */
export const CUSUM_DRIFT = 0.5;
/** §D7: CUSUM decision interval `h = 5σ` (as a multiple of `sigma`). */
export const CUSUM_THRESHOLD = 5;
/** §D7: Bayesian change-point hazard 1/100. */
export const CHANGE_POINT_HAZARD = 1 / 100;

export interface SpcInput {
    /** The metric's per-run values, oldest first. */
    values: readonly number[];
    /** The in-control standard deviation of the metric (the scale of one run's noise). */
    sigma: number;
    /** The kill switch off ⇒ `model-disabled`. */
    disabled?: boolean;
}

/** A detected process-control signal (a trend annotation, never a verdict). */
export type SpcSignal =
    | {
          kind: 'cusum';
          /** The index into `values` where the cumulative sum crossed the threshold. */
          alarmIndex: number;
      }
    | {
          kind: 'change-point';
          /** The index into `values` with the highest change-point posterior probability. */
          index: number;
          /** The posterior probability of a regime change at `index`. */
          probability: number;
      };

export interface SpcResult {
    status: Prediction['status'];
    /** The history length the detectors ran on. */
    n: number;
    /** The CUSUM detector result, when history was sufficient. */
    cusum: CusumResult | undefined;
    /** The change-point posterior, when history was sufficient. */
    changePoint: ChangePointResult | undefined;
    /** The strongest signal, if any: CUSUM alarm first, then the change-point MAP. */
    signal: SpcSignal | undefined;
    /** "learning baseline" until {@link SPC_MIN_HISTORY} runs exist. */
    baseline: boolean;
}

/**
 * Run both §D7 detectors over the series. Below {@link SPC_MIN_HISTORY} runs the result is
 * `insufficient-data` and `baseline` is true (the surface shows "learning baseline"). Above
 * it the detectors run deterministically; a signal is a trend annotation, not a verdict.
 */
export function detectTrendShift(input: SpcInput): SpcResult {
    if (input.disabled) {
        return { status: 'model-disabled', n: input.values.length, cusum: undefined, changePoint: undefined, signal: undefined, baseline: false };
    }
    const n = input.values.length;
    if (n < SPC_MIN_HISTORY) {
        return { status: 'insufficient-data', n, cusum: undefined, changePoint: undefined, signal: undefined, baseline: true };
    }
    const sigma = input.sigma > 0 ? input.sigma : 1;
    const cusumResult = cusum(input.values, CUSUM_TARGET, { sigma, threshold: CUSUM_THRESHOLD, drift: CUSUM_DRIFT });
    const changePoint = bayesianOnlineChangePoint(input.values, { hazard: CHANGE_POINT_HAZARD });

    let signal: SpcSignal | undefined;
    if (cusumResult.alarmIndex >= 0) {
        signal = { kind: 'cusum', alarmIndex: cusumResult.alarmIndex };
    } else {
        let bestIndex = 0;
        let bestProbability = -1;
        changePoint.changePointProbabilities.forEach((probability, index) => {
            if (probability > bestProbability) {
                bestProbability = probability;
                bestIndex = index;
            }
        });
        if (bestProbability > 0) {
            signal = { kind: 'change-point', index: bestIndex, probability: bestProbability };
        }
    }
    return { status: 'ok', n, cusum: cusumResult, changePoint, signal, baseline: false };
}

const quantize = (v: number): number => Math.round(v * 1000) / 1000;

/** THE `Prediction` shape (§D0.2) for an SPC result: the value is the signal probability (0 when none), quantized. */
export function spcPrediction(input: SpcInput, result: SpcResult): Prediction {
    const probability = result.signal?.kind === 'change-point' ? result.signal.probability : result.signal?.kind === 'cusum' ? 1 : 0;
    const digest = `metric-spc:v${METRIC_SPC_SCHEMA_VERSION}:${result.n}n:${input.sigma.toFixed(6)}:${result.signal?.kind ?? 'none'}`;
    return {
        id: METRIC_SPC_PREDICTION_ID,
        modelId: METRIC_SPC_MODEL_ID,
        modelVersion: METRIC_SPC_MODEL_VERSION,
        featureSchemaVersion: METRIC_SPC_SCHEMA_VERSION,
        value: result.status === 'ok' ? quantize(probability) : 0,
        explanation:
            result.status === 'ok'
                ? [
                      { feature: 'spc.history', contribution: result.n },
                      { feature: 'spc.sigma', contribution: quantize(input.sigma) },
                      { feature: 'spc.signal', contribution: probability },
                  ]
                : [],
        status: result.status,
        inputDigest: digest,
    };
}
