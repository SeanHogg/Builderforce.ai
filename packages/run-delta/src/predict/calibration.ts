/**
 * predict/calibration.ts — §D4 calibration of heuristic rule scores to probabilities.
 * Platt scaling (σ(A·s + B)) while there are fewer than 1,000 labelled examples; isotonic
 * regression (pool-adjacent-violators) at 1,000 or more. Quality is tracked with the Brier
 * score and the expected calibration error (ECE); a model is recalibrated when its ECE
 * exceeds 0.05 on the trailing window.
 *
 * THE maths (Platt / isotonic fitting, Brier, ECE) lives in the builderforce-memory `stats`
 * module (§D13); this file composes it and never re-implements it. Pure and deterministic:
 * no I/O, no clock, no randomness. Advisory only (§D0): a `Prediction` over calibrated
 * probability, never a verdict input.
 */

import {
    brierScore,
    expectedCalibrationError,
    fitIsotonic,
    fitPlattScaling,
    type IsotonicFit,
} from '@seanhogg/builderforce-memory/stats';
import type { Prediction } from './prediction.js';

/** `rule.calibration` — the prediction id of the calibration quality model. */
export const RULE_CALIBRATION_PREDICTION_ID = 'rule.calibration';
export const RULE_CALIBRATION_MODEL_ID = 'rule.calibration';
export const RULE_CALIBRATION_MODEL_VERSION = '1.0.0';
/** Bumped when the fit method, the ECE gate or the binning changes. */
export const RULE_CALIBRATION_SCHEMA_VERSION = 1;

/** §D4: switch to isotonic at this many labelled examples. */
export const ISOTONIC_MIN_EXAMPLES = 1000;
/** §D4 / §D12: recalibrate when ECE exceeds this on the trailing window. */
export const ECE_RECALIBRATE_THRESHOLD = 0.05;
/** §D4: ECE is computed over 10 equal-mass bins. */
export const ECE_BINS = 10;

/** The fit method chosen by the example count (§D4). */
export type CalibrationMethod = 'platt' | 'isotonic';

export interface CalibrationExample {
    /** The heuristic score in [0, 1]. */
    score: number;
    /** The realized outcome: 1 = the finding was a true positive, 0 = false positive. */
    outcome: 0 | 1;
}

export interface CalibrateScoresInput {
    /** The labelled (score, outcome) examples, in any order. */
    examples: readonly CalibrationExample[];
    /** The kill switch off ⇒ `model-disabled`. */
    disabled?: boolean;
}

export interface CalibrationFit {
    method: CalibrationMethod;
    /** The calibrated probability for a raw score, in [0, 1]. */
    predict(score: number): number;
    /** The number of labelled examples the fit was trained on. */
    n: number;
    /** The held-out Brier score of the calibrated probabilities (lower is better). */
    brier: number;
    /** The held-out expected calibration error over {@link ECE_BINS} bins (lower is better). */
    ece: number;
    /** True when `ece` exceeds {@link ECE_RECALIBRATE_THRESHOLD} and a refit is due. */
    recalibrate: boolean;
}

export interface CalibrateScoresResult {
    status: Prediction['status'];
    fit: CalibrationFit | undefined;
    /** The deterministic fit inputs, for replay and tests. */
    digest: string;
}

const quantize = (v: number): number => Math.round(v * 1000) / 1000;

function digestOf(n: number, method: string, brier: number, ece: number): string {
    return `rule-calibration:v${RULE_CALIBRATION_SCHEMA_VERSION}:${n}n:${method}:${brier.toFixed(6)}/${ece.toFixed(6)}`;
}

/**
 * Split the examples deterministically into a train / held-out half by index parity, fit the
 * calibration on the train half (Platt below {@link ISOTONIC_MIN_EXAMPLES}, isotonic at or
 * above it) and score the held-out half with Brier and ECE. With too few examples to hold
 * anything out there is nothing to calibrate: `insufficient-data`.
 */
export function calibrateScores(input: CalibrateScoresInput): CalibrateScoresResult {
    if (input.disabled) {
        return { status: 'model-disabled', fit: undefined, digest: digestOf(0, 'none', 0, 0) };
    }
    const n = input.examples.length;
    if (n < 4) {
        return { status: 'insufficient-data', fit: undefined, digest: digestOf(n, 'none', 0, 0) };
    }
    // Deterministic interleaved split so the same inputs always give the same fit and scores.
    const train: CalibrationExample[] = [];
    const heldOut: CalibrationExample[] = [];
    input.examples.forEach((example, i) => (i % 2 === 0 ? train : heldOut).push(example));
    if (train.length === 0 || heldOut.length === 0) {
        return { status: 'insufficient-data', fit: undefined, digest: digestOf(n, 'none', 0, 0) };
    }

    const method: CalibrationMethod = n >= ISOTONIC_MIN_EXAMPLES ? 'isotonic' : 'platt';
    const scores = train.map((e) => e.score);
    const outcomes = train.map((e) => e.outcome);
    const predict =
        method === 'platt'
            ? fitPlattScaling(scores, outcomes).predict
            : (fitIsotonic(scores, outcomes) as IsotonicFit).predict;

    const heldProbs = heldOut.map((e) => predict(e.score));
    const heldOutcomes = heldOut.map((e) => e.outcome);
    const brier = brierScore(heldProbs, heldOutcomes);
    const ece = expectedCalibrationError(heldProbs, heldOutcomes, ECE_BINS);
    const fit: CalibrationFit = {
        method,
        predict,
        n,
        brier,
        ece,
        recalibrate: ece > ECE_RECALIBRATE_THRESHOLD,
    };
    return { status: 'ok', fit, digest: digestOf(n, method, brier, ece) };
}

/** THE `Prediction` shape (§D0.2) for a calibration result: the value is the held-out ECE, quantized. */
export function calibrationPrediction(result: CalibrateScoresResult): Prediction {
    const fit = result.fit;
    return {
        id: RULE_CALIBRATION_PREDICTION_ID,
        modelId: RULE_CALIBRATION_MODEL_ID,
        modelVersion: RULE_CALIBRATION_MODEL_VERSION,
        featureSchemaVersion: RULE_CALIBRATION_SCHEMA_VERSION,
        value: result.status === 'ok' && fit ? quantize(fit.ece) : 0,
        explanation:
            result.status === 'ok' && fit
                ? [
                      { feature: 'calibration.examples', contribution: fit.n },
                      { feature: 'calibration.method', contribution: fit.method === 'platt' ? 0 : 1 },
                      { feature: 'calibration.brier', contribution: quantize(fit.brier) },
                      { feature: 'calibration.ece', contribution: quantize(fit.ece) },
                  ]
                : [],
        status: result.status,
        inputDigest: result.digest,
    };
}
