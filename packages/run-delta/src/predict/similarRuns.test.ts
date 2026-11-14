/**
 * predict/similarRuns.test.ts — PRD 41 §D10.2: nearest prior runs by standardized RunFeatures,
 * k = 10, ties by runId, final-labelled runs only, below 50 ⇒ insufficient-data.
 */

import { describe, expect, it } from 'vitest';
import type { RunFeatures, RunOutcomeLabel } from './contract.js';
import { SIMILAR_RUNS_K, SIMILAR_RUNS_MIN_LABELLED, SIMILAR_RUNS_PREDICTION_ID, similarRuns } from './similarRuns.js';

const RUN_FEATURES_SCHEMA_VERSION = 1;

/** A feature vector: every id in canonical order; `over` overrides individual values. */
const features = (runId: string, over: Record<string, number> = {}): RunFeatures => {
    const ids = [
        'size.linesAdded', 'size.linesDeleted', 'size.filesTouched',
        'spread.entropy', 'spread.entropyNormalized',
        'structure.centralitySum', 'structure.centralityMax', 'structure.entryPointsReached',
        'structure.layersTouched', 'structure.crossPartitionEdgesChanged',
        'history.churn90d', 'history.pastFollowupFixes', 'history.ageDaysMean',
        'delta.security.introduced', 'delta.security.resolved', 'delta.security.changed',
        'delta.performance.introduced', 'delta.performance.resolved', 'delta.performance.changed',
        'delta.quality.introduced', 'delta.quality.resolved', 'delta.quality.changed',
        'delta.integrityFindings', 'delta.testsChanged', 'delta.diffCoverage',
        'run.autonomous', 'run.steps', 'run.toolFailures',
        'people.priorRunsInRepo', 'people.priorChangesToTouchedFiles', 'people.tenureDays',
    ] as const;
    const values = Object.fromEntries(ids.map((id) => [id, over[id] ?? 0])) as RunFeatures['values'];
    return {
        schemaVersion: RUN_FEATURES_SCHEMA_VERSION,
        runId,
        repository: 'local:repo',
        finalizedAt: '2026-11-14T00:00:00.000Z',
        values,
        run: { entryPoint: 'vscode', mode: 'interactive', modelTier: null },
        people: {},
        digest: `digest-${runId}`,
    };
};

const finalLabel = (kind: RunOutcomeLabel['kind'], value: boolean): RunOutcomeLabel => ({
    kind, value, status: 'final', evidence: {}, labellerVersion: 1, computedAt: '2026-11-14T00:00:00.000Z',
});

const run = (runId: string, over: Record<string, number> = {}, labels: RunOutcomeLabel[] = [finalLabel('followup-fix', false)]) =>
    ({ features: features(runId, over), labels });

const manyRuns = (n: number, over: Record<string, number> = {}, labels?: RunOutcomeLabel[]) =>
    Array.from({ length: n }, (_, i) => run(`prior-${String(i).padStart(3, '0')}`, over, labels));

describe('similarRuns (PRD 41 §D10.2)', () => {
    it('is insufficient-data below 50 final-labelled runs (D0.5)', () => {
        const out = similarRuns(manyRuns(SIMILAR_RUNS_MIN_LABELLED - 1), features('this'));
        expect(out.prediction.status).toBe('insufficient-data');
        expect(out.k).toBe(0);
        expect(out.similar).toEqual([]);
    });

    it('counts censored-only runs toward neither the threshold nor the neighbours', () => {
        const censored = { ...finalLabel('followup-fix', false), status: 'censored' as const, value: null };
        const out = similarRuns(manyRuns(SIMILAR_RUNS_MIN_LABELLED, {}, [censored]), features('this'));
        expect(out.prediction.status).toBe('insufficient-data');
    });

    it('returns k = 10 neighbours at the threshold, nearest by Euclidean distance', () => {
        const candidates = manyRuns(SIMILAR_RUNS_MIN_LABELLED);
        // Make the first candidate the closest by giving it the run's own shape.
        candidates[0] = run('closest', { 'size.linesAdded': 5, 'run.steps': 2 });
        const me = features('this', { 'size.linesAdded': 5, 'run.steps': 2 });
        const out = similarRuns(candidates, me);
        expect(out.prediction.status).toBe('ok');
        expect(out.k).toBe(SIMILAR_RUNS_K);
        expect(out.similar).toHaveLength(SIMILAR_RUNS_K);
        expect(out.similar[0]!.runId).toBe('closest');
        expect(out.similar[0]!.distance).toBe(0);
    });

    it('breaks distance ties by runId', () => {
        const candidates = manyRuns(SIMILAR_RUNS_MIN_LABELLED);
        const out = similarRuns(candidates, features('this')); // all identical ⇒ all distance 0
        const ids = out.similar.map((s) => s.runId);
        expect(ids).toEqual([...ids].sort());
    });

    it('imputes a null feature to the median so a missing measurement is neutral, not zero', () => {
        const candidates = manyRuns(SIMILAR_RUNS_MIN_LABELLED, { 'size.linesAdded': 100 });
        // This run has no size.linesAdded; the candidates all have 100 (median 100). It must still rank by the
        // remaining features rather than collapse every distance to the same value.
        const me = features('this');
        (me.values as Record<string, number | null>)['size.linesAdded'] = null;
        const out = similarRuns(candidates, me);
        expect(out.prediction.status).toBe('ok');
        expect(out.similar.every((s) => Number.isFinite(s.distance))).toBe(true);
    });

    it('buckets outcomes: reverted beats followup-fix beats no-followup', () => {
        const candidates = manyRuns(SIMILAR_RUNS_MIN_LABELLED);
        // Identical features ⇒ all distances tie and `runId` breaks the tie: name the labelled runs so they sort first.
        candidates[0] = run('0-reverted', {}, [finalLabel('reverted', true)]);
        candidates[1] = run('1-followup', {}, [finalLabel('followup-fix', true)]);
        const out = similarRuns(candidates, features('this'));
        expect(out.outcomes.reverted).toBeGreaterThanOrEqual(1);
        expect(out.outcomes['followup-fix']).toBeGreaterThanOrEqual(1);
        // The remaining neighbours carry the default no-followup label.
        expect(out.outcomes['no-followup']).toBe(SIMILAR_RUNS_K - out.outcomes.reverted - out.outcomes['followup-fix'] - out.outcomes.other);
    });

    it('carries the run digest as inputDigest so a shown prediction replays', () => {
        const out = similarRuns(manyRuns(SIMILAR_RUNS_MIN_LABELLED), features('this'));
        expect(out.prediction.inputDigest).toBe('digest-this');
        expect(out.prediction.id).toBe(SIMILAR_RUNS_PREDICTION_ID);
        // value is the no-followup count (the "N of the k needed no follow-up" number).
        expect(out.prediction.value).toBe(out.outcomes['no-followup']);
    });
});
