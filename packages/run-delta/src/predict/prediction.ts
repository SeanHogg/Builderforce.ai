/**
 * predict/prediction.ts — THE shape every Part D model answers with (PRD 41 §D0.2): the value with its uncertainty and its
 * provenance, so any shown prediction can be replayed (§D12 audit: model version + `inputDigest`).
 *
 * D0: a prediction never sets or changes a verdict. It is rendered apart (the card's "Predicted" block, ≈ wording, no verdict
 * colours), and a model below its data threshold answers `insufficient-data`, which a surface shows as nothing.
 *
 * Pure types: no I/O, no clock, no randomness.
 */

/** Why a model did, or did not, produce a value. Anything but `ok` renders as nothing. */
export type PredictionStatus = 'ok' | 'insufficient-data' | 'not-applicable' | 'model-disabled';

/** One feature's share of a prediction, in the model's own units (the top contributions, sorted). */
export interface PredictionContribution {
    feature: string;
    contribution: number;
}

export interface Prediction {
    /** What is predicted: `'risk.followup-fix'`, `'naturalness.unusual-lines'`, … */
    id: string;
    modelId: string;
    modelVersion: string;
    featureSchemaVersion: number;
    /** A probability, count or metric, quantized. */
    value: number;
    /** Credible / confidence / prediction interval. Absent for a deterministic count (e.g. naturalness), which has none. */
    interval?: [number, number];
    /** Set only by a model whose section defines its band thresholds. */
    band?: 'low' | 'medium' | 'high';
    /** The top contributions, sorted by |contribution| descending. */
    explanation: PredictionContribution[];
    status: PredictionStatus;
    /** sha256 of the canonical input vector: the same digest and model version replay the same prediction. */
    inputDigest: string;
}
