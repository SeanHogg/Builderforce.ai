/**
 * predict/ranking.ts — order a run delta's findings so people look at the highest-value first
 * (PRD 41 §D10.1). Until the pairwise logistic model ships (D10.1's trained ranker, which waits
 * on WS18's labels), ranking uses the same feature FAMILY with a transparent, deterministic
 * weight vector — severity, rule precision posterior (D3), lineage, dimension and confidence —
 * so the ORDER is already highest-value-first and the evaluation hook below measures it with
 * NDCG@5, the §D10 quality metric.
 *
 * D0/D10.1: ranking changes ORDER ONLY. Ties break by `findingId` — a finding's content never
 * changes, and the same delta ranks identically on every machine, offline included. Nothing
 * under `verdict/` may import this (the `check:run-delta-layers` guard).
 *
 * Pure: no I/O, no clock, no randomness.
 */

import { ndcgAtK } from '@seanhogg/builderforce-memory/stats';
import type { DeltaFinding } from '../contract.js';
import type { Prediction } from './prediction.js';

/** The ids this module predicts under (§D0.2's `Prediction.id`). */
export const FINDING_RANK_PREDICTION_ID = 'finding.rank';
export const FINDING_RANK_MODEL_ID = 'builderforce/finding-rank';
/** v1: the transparent weighted heuristic; v2 is the pairwise logistic head (D10.1). */
export const FINDING_RANK_MODEL_VERSION = 'v1';
export const FINDING_RANK_SCHEMA_VERSION = 1;

/** A rule's Bayesian precision posterior (D3), when one was computed for it; else `undefined`. */
export interface RulePrecisionLookup {
    (ruleId: string): number | undefined;
}

const SEVERITY_SCORE = { error: 1, warn: 0.6, info: 0.25 } as const;
/** Dimension weights mirror the C11 reading order: what the person scans first matters most. */
const DIMENSION_SCORE: Readonly<Record<string, number>> = {
    security: 1, quality: 0.9, performance: 0.7,
};
const LINEAGE_SCORE = { introduced: 1, changed: 0.9, persisting: 0.5, present: 0.4, resolved: 0.1 } as const;
const CONFIDENCE_SCORE = { measured: 1, heuristic: 0.7 } as const;

/**
 * The rankable features of one finding, all in `[0, 1]`. `rulePrecision` is the D3 posterior for
 * the finding's rule (a rule shown to be precise floats its findings up).
 */
export interface FindingRankFeatures {
    severity: number;
    rulePrecision: number;
    dimension: number;
    lineage: number;
    confidence: number;
}

/** Extract {@link FindingRankFeatures} from a finding. Missing context is neutral (0.5), never zero. */
export function findingRankFeatures(
    finding: DeltaFinding,
    rulePrecision: RulePrecisionLookup = () => undefined,
): FindingRankFeatures {
    return {
        severity: SEVERITY_SCORE[finding.severity],
        rulePrecision: rulePrecision(finding.ruleId) ?? 0.5,
        dimension: DIMENSION_SCORE[finding.dimension] ?? 0.6,
        lineage: LINEAGE_SCORE[finding.lineage] ?? 0.5,
        confidence: CONFIDENCE_SCORE[finding.confidence] ?? 0.85,
    };
}

/** The v1 weight vector over {@link FindingRankFeatures}, in the same key order. */
export const FINDING_RANK_WEIGHTS: Readonly<Record<keyof FindingRankFeatures, number>> = {
    severity: 3, rulePrecision: 2, dimension: 1.5, lineage: 1, confidence: 0.5,
};

/** The v1 score: a weighted sum, the transparent stand-in for the pairwise logistic head. */
export function findingRankScore(f: FindingRankFeatures): number {
    return (Object.keys(FINDING_RANK_WEIGHTS) as (keyof FindingRankFeatures)[])
        .reduce((sum, k) => sum + FINDING_RANK_WEIGHTS[k] * f[k], 0);
}

/**
 * Order `findings` highest-value first (§D10.1). Deterministic: score descending, ties by
 * `finding.identity.id`. Pass the run's D3 posterior through `rulePrecision` when one is loaded.
 */
export function rankFindings(
    findings: readonly DeltaFinding[],
    rulePrecision: RulePrecisionLookup = () => undefined,
): DeltaFinding[] {
    return [...findings]
        .map((finding) => ({ finding, score: findingRankScore(findingRankFeatures(finding, rulePrecision)) }))
        .sort((a, b) => b.score - a.score || (a.finding.identity.id < b.finding.identity.id ? -1 : a.finding.identity.id > b.finding.identity.id ? 1 : 0))
        .map((x) => x.finding);
}

/** Quantize a score to the package step, for a stored rank value (D0.3). */
export const FINDING_RANK_STEP = 1e-4;
export const quantizeRankScore = (score: number): number => Math.round(score / FINDING_RANK_STEP) * FINDING_RANK_STEP;

/** Graded relevance of a finding for NDCG: the ranked order should put the severe, actionable ones first. */
export function findingRelevance(finding: DeltaFinding): number {
    return SEVERITY_SCORE[finding.severity] * LINEAGE_SCORE[finding.lineage];
}

/**
 * The §D10 quality metric: NDCG@5 of the produced order against each finding's graded relevance
 * (`findingRelevance`). Delegates to the memory `stats` module (§D13's one home for the maths).
 * `undefined` when the ranking is empty — no metric over nothing.
 */
export function rankNdcgAt5(findings: readonly DeltaFinding[]): number | undefined {
    if (findings.length === 0) return undefined;
    const ranked = rankFindings(findings);
    const relevances = ranked.map(findingRelevance);
    return ndcgAtK(relevances, 5);
}

/** The rank prediction for a run's findings (§D0.2 shape): `ndcgAt5` is the quality metric, `k` the ranked count. */
export interface FindingRankResult {
    modelVersion: string;
    k: number;
    ndcgAt5: number;
    prediction: Prediction;
}

/**
 * Rank one run's findings and answer with the §D0.2 prediction plus the NDCG@5 of the produced
 * order. The value is the quantized score of the top finding — the "look at this first" signal —
 * so it renders as a prediction, never as a verdict. `inputDigest` is the run's own feature
 * digest: the same run replays the same ranking.
 */
export function predictFindingRank(runInputDigest: string, findings: readonly DeltaFinding[]): FindingRankResult {
    const ranked = rankFindings(findings);
    const k = Math.min(ranked.length, 5);
    const relevance = ranked.slice(0, k).map(findingRelevance);
    const ndcgAt5 = relevance.length > 0 ? ndcgAtK(relevance, 5) : 0;
    const top = ranked[0];
    const explanation = top
        ? (Object.entries(FINDING_RANK_WEIGHTS) as [keyof FindingRankFeatures, number][])
            .map(([feature, weight]) => ({ feature, contribution: quantizeRankScore(weight * findingRankFeatures(top)[feature]) }))
            .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        : [];
    return {
        modelVersion: FINDING_RANK_MODEL_VERSION,
        k: ranked.length,
        ndcgAt5,
        prediction: {
            id: FINDING_RANK_PREDICTION_ID,
            modelId: FINDING_RANK_MODEL_ID,
            modelVersion: FINDING_RANK_MODEL_VERSION,
            featureSchemaVersion: FINDING_RANK_SCHEMA_VERSION,
            value: top ? quantizeRankScore(findingRankScore(findingRankFeatures(top))) : 0,
            explanation,
            status: 'ok',
            inputDigest: runInputDigest,
        },
    };
}
