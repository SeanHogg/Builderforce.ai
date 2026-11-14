/**
 * predict/similarRuns.ts — the runs most like this one (PRD 41 §D10.2): nearest prior runs by
 * standardized `RunFeatures` (WS16) Euclidean distance, `k = 10`, ties broken by `runId`. Only
 * FINAL-labelled runs count (§D10.2), and below {@link SIMILAR_RUNS_MIN_LABELLED} of them the
 * answer is `insufficient-data` (D0.5) — a guess is never shown as a prediction.
 *
 * The renderable summary is outcome-shaped, like "7 of the 10 most similar runs needed no
 * follow-up; 2 were reverted" — the counts of {@link SimilarRunOutcome}: `no-followup`,
 * `followup-fix`, `reverted`, `other`. A similar run counts as `reverted` first (it was undone),
 * then `followup-fix` (it needed a repair); with neither label it is a `no-followup` run.
 *
 * D0: advisory only — order and counts, never a verdict. Pure and deterministic: `null` features
 * are imputed to the training-set median of that feature, standardization uses the training set's
 * mean/sd, ties break by `runId`.
 */

import type { RunFeatures, RunOutcomeLabel } from './contract.js';
import type { Prediction } from './prediction.js';

/** The id this prediction answers under (§D0.2's `Prediction.id`). */
export const SIMILAR_RUNS_PREDICTION_ID = 'similar-runs.outcomes';
export const SIMILAR_RUNS_MODEL_ID = 'builderforce/similar-runs';
export const SIMILAR_RUNS_MODEL_VERSION = 'v1';
export const SIMILAR_RUNS_SCHEMA_VERSION = 1;

/** §D10.2: at least 50 final-labelled runs in the repo (or consenting tenants with the same language mix). */
export const SIMILAR_RUNS_MIN_LABELLED = 50;
/** §D10.2's k. */
export const SIMILAR_RUNS_K = 10;

/** One similar prior run and its distance to this run (lower = more similar). */
export interface SimilarRun {
    runId: string;
    distance: number;
}

/** The outcome bucket a similar run falls into, for the "N of the k …" sentence. */
export type SimilarRunOutcome = 'no-followup' | 'followup-fix' | 'reverted' | 'other';

/** The k-NN result plus the outcome counts and the §D0.2 prediction. */
export interface SimilarRunsResult {
    k: number;
    similar: SimilarRun[];
    outcomes: Record<SimilarRunOutcome, number>;
    prediction: Prediction;
}

const outcomeOf = (labels: readonly RunOutcomeLabel[]): SimilarRunOutcome => {
    const final = labels.filter((l) => l.status === 'final');
    if (final.some((l) => l.kind === 'reverted' && l.value === true)) return 'reverted';
    if (final.some((l) => l.kind === 'followup-fix' && l.value === true)) return 'followup-fix';
    if (final.some((l) => l.kind === 'ci-red-after-merge' && l.value === true)) return 'other';
    if (final.some((l) => l.kind === 'review-rejected' && l.value === true)) return 'other';
    return 'no-followup';
};

/** Mean and population sd of `xs`, ignoring null/undefined. */
function meanSd(xs: readonly (number | null | undefined)[]): { mean: number; sd: number } {
    const vals = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    const n = vals.length;
    if (n === 0) return { mean: 0, sd: 0 };
    const mean = vals.reduce((a, b) => a + b, 0) / n;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
    return { mean, sd: Math.sqrt(variance) };
}

/**
 * Nearest prior runs by standardized Euclidean distance over the feature vector's numeric
 * values, in canonical order (the same order for both runs). Only `final` labels count toward
 * {@link SIMILAR_RUNS_MIN_LABELLED}; `candidates` must be PRIOR runs (the caller never offers the
 * run itself). Below the threshold the prediction is `insufficient-data` (D0.5) and the surface
 * shows nothing.
 *
 * @param candidates prior runs of the same repository (or consenting tenants), each with its labels.
 * @param run this run's frozen features; its `digest` is the `inputDigest` a replay needs.
 */
export function similarRuns(
    candidates: ReadonlyArray<{ features: RunFeatures; labels: readonly RunOutcomeLabel[] }>,
    run: RunFeatures,
): SimilarRunsResult {
    const usable = candidates.filter((c) => c.labels.some((l) => l.status === 'final'));
    const base: SimilarRunsResult = {
        k: 0,
        similar: [],
        outcomes: { 'no-followup': 0, 'followup-fix': 0, reverted: 0, other: 0 },
        prediction: {
            id: SIMILAR_RUNS_PREDICTION_ID,
            modelId: SIMILAR_RUNS_MODEL_ID,
            modelVersion: SIMILAR_RUNS_MODEL_VERSION,
            featureSchemaVersion: SIMILAR_RUNS_SCHEMA_VERSION,
            value: 0,
            explanation: [],
            status: 'insufficient-data',
            inputDigest: run.digest,
        },
    };
    if (usable.length < SIMILAR_RUNS_MIN_LABELLED) return base;

    const keys = Object.keys(run.values) as Array<keyof RunFeatures['values']>;
    // Median per feature (over usable candidates) imputes a missing value: deterministic, and a
    // missing measurement is carried through as neutral rather than dropped per-pair.
    const medians = new Map<string, number>();
    for (const key of keys) {
        const vals = usable.map((c) => c.features.values[key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
        medians.set(key, vals.length > 0 ? vals[Math.floor(vals.length / 2)]! : 0);
    }
    const stats = new Map<string, { mean: number; sd: number }>();
    for (const key of keys) {
        stats.set(key, meanSd(usable.map((c) => c.features.values[key])));
    }
    const val = (f: RunFeatures, key: string): number => {
        const raw = f.values[key as keyof RunFeatures['values']];
        const v = typeof raw === 'number' && Number.isFinite(raw) ? raw : medians.get(key)!;
        const { mean, sd } = stats.get(key)!;
        return sd > 0 ? (v - mean) / sd : 0;
    };
    const distance = (a: RunFeatures, b: RunFeatures): number =>
        Math.sqrt(keys.reduce((sum, key) => sum + (val(a, key) - val(b, key)) ** 2, 0));

    const ranked = usable
        .map((c) => ({ runId: c.features.runId, distance: distance(run, c.features), labels: c.labels }))
        .sort((a, b) => a.distance - b.distance || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0))
        .slice(0, SIMILAR_RUNS_K);

    const outcomes = { ...base.outcomes };
    for (const r of ranked) outcomes[outcomeOf(r.labels)]++;
    const noFollowup = outcomes['no-followup'];
    return {
        k: ranked.length,
        similar: ranked.map(({ runId, distance }) => ({ runId, distance })),
        outcomes,
        prediction: {
            ...base.prediction,
            status: 'ok',
            value: noFollowup,
            explanation: [
                { feature: 'k', contribution: ranked.length },
                { feature: 'no-followup', contribution: noFollowup },
                { feature: 'reverted', contribution: outcomes.reverted },
                { feature: 'followup-fix', contribution: outcomes['followup-fix'] },
            ],
        },
    };
}
