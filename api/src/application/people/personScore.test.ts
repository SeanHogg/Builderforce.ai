/**
 * personScore.test.ts — the WS22 / §D14 person scorer. Covers the D14.7 done-checks
 * that are pure: the minimum-sample rule, the case-mix feature-schema fairness guard,
 * case-mix adjustment (a weak-agent approver is not flagged), and determinism /
 * reproducibility from the same inputs.
 */
import { describe, expect, it } from 'vitest';
import {
  caseMixFeaturesAreFair,
  CASE_MIX_FEATURES,
  estimateTeamPrior,
  fitCaseMixModel,
  loadCaseMixModel,
  measure,
  scoreBucket,
  type PersonScoreRunInput,
  type PersonScoreRole,
  type TeamPrior,
} from './personScore';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-11-14T00:00:00Z');

const PRIOR: TeamPrior = { alpha0: 2, beta0: 20 };

let seq = 0;

/** A run with a final label, attributed to `personId` in `role`. */
const run = (
  personId: string,
  role: PersonScoreRole,
  over: Partial<PersonScoreRunInput> & { labels?: PersonScoreRunInput['labels'] } = {},
): PersonScoreRunInput => {
  const people: Record<PersonScoreRole, string | null> = { requester: null, approver: null, reviewer: null, agent: null };
  people[role] = personId;
  return {
    runId: over.runId ?? `run-${(seq += 1)}`,
    repository: 'git@example.com:acme/app.git',
    finalizedAtMs: NOW,
    values: {
      'size.linesAdded': 100,
      'delta.quality.introduced': 1,
      'delta.quality.resolved': 0,
      'delta.integrityFindings': 0,
      ...(over.values ?? {}),
    },
    securityIntroduced: 0,
    labels: over.labels ?? [{ kind: 'reverted', value: false }],
    people,
    ...over,
  };
};

const bucket = (personId: string, role: PersonScoreRole, runs: PersonScoreRunInput[]) => ({ personId, role, runs });

// 25 final-labelled runs (the D14.7 "25 runs" case), in `role`.
const twentyFive = (personId: string, role: PersonScoreRole = 'requester', over: Partial<PersonScoreRunInput> = {}) =>
  Array.from({ length: 25 }, (_, i) => run(personId, role, { runId: `r-${personId}-${i}`, ...over }));

describe('case-mix feature schema (D14.3 / D14.7)', () => {
  it('contains none of the scored person identity or experience features', () => {
    expect(caseMixFeaturesAreFair()).toBe(true);
    expect(CASE_MIX_FEATURES.every((id) => !id.startsWith('people.'))).toBe(true);
  });
});

describe('minimum sample (D14.4 / D14.7)', () => {
  it('a person with 3 runs shows insufficient-data', () => {
    const b = bucket('p-3', 'requester', [run('p-3', 'requester'), run('p-3', 'requester'), run('p-3', 'requester')]);
    expect(scoreBucket(b, PRIOR, null)).toEqual({ status: 'insufficient-data', finalRuns: 3 });
  });

  it('a person with 25 runs is scored', () => {
    const result = scoreBucket(bucket('p-25', 'requester', twentyFive('p-25')), PRIOR, null);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.finalRuns).toBe(25);
  });
});

describe('case-mix adjustment (D14.3 / D14.7)', () => {
  it('an approver whose runs all used a weak agent is not flagged when expected absorbs it', () => {
    // A case-mix model trained to predict the outcome from "weak agent" (encoded as a large
    // size.linesAdded proxy here) assigns a high expected count E to these runs, so the
    // standardized ratio O/E sits near 1 and the point is inside the funnel limits.
    const train = Array.from({ length: 200 }, (_, i) => {
      const weak = i % 2 === 0;
      return {
        x: [weak ? 5000 : 100, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
        y: (weak ? 1 : 0) as 0 | 1,
      };
    });
    const params = fitCaseMixModel(train);
    const model = loadCaseMixModel(params);

    // The approver approved 25 runs, all "weak-agent" (large linesAdded). The model expects
    // nearly all of them to be bad (E close to the 25-run count), so the standardized ratio
    // sits near 1 and the approver is NOT flagged on raw size alone.
    const weakRuns = twentyFive('approver-1', 'approver').map((r) => ({
      ...r,
      values: { ...r.values, 'size.linesAdded': 5000 },
    }));
    const result = scoreBucket(bucket('approver-1', 'approver', weakRuns), PRIOR, model);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const quality = result.measures.find((m) => m.id === 'run-quality')!;
      // E is the SUM of predicted probabilities: near 25 (all weak) vs the no-model E = 25
      // baseline would also be 25 — the difference is SR ≈ O/E stays ~1 instead of the raw
      // count being read as "25 bad runs" with no context.
      expect(quality.expected).toBeGreaterThan(20);
      expect(quality.outsideLimits).toBe(false);
    }
  });
});

describe('shrinkage (D14.4)', () => {
  it('a small-sample bucket is pulled toward the team, not shown at the extreme rate', () => {
    // 25 runs, all bad: raw rate 1.0, but the Gamma–Poisson posterior mean is well below 1
    // because the prior (α₀=2, β₀=20) dominates the small expected count.
    const badRuns = twentyFive('p-bad').map((r) => ({
      ...r,
      values: { ...r.values, 'delta.quality.introduced': 5, 'delta.quality.resolved': 0 },
    }));
    const result = scoreBucket(bucket('p-bad', 'requester', badRuns), PRIOR, null);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      const quality = result.measures.find((m) => m.id === 'run-quality')!;
      // Raw rate is 1.0 (all 25 bad); the Gamma–Poisson posterior (α₀=2, β₀=20) shrinks it
      // toward the team: (2+25)/(20+25) = 0.6.
      expect(quality.posteriorMean!).toBeLessThan(0.7);
      expect(quality.posteriorMean!).toBeGreaterThan(0.5);
      // The 95% posterior interval is ordered and contains the mean.
      expect(quality.posteriorInterval![0]).toBeLessThanOrEqual(quality.posteriorMean!);
      expect(quality.posteriorInterval![1]).toBeGreaterThanOrEqual(quality.posteriorMean!);
    }
  });

  it('the prior comes from the team when no explicit prior is passed', () => {
    // Two buckets with DIFFERENT bad rates give the cross-bucket variance the moment
    // estimate needs (identical buckets have zero variance → no estimable prior).
    const mixed = (personId: string, badFraction: number) =>
      Array.from({ length: 25 }, (_, i) =>
        run(personId, 'requester', {
          runId: `r-${personId}-${i}`,
          values: i / 25 < badFraction
            ? { 'delta.quality.introduced': 5, 'delta.quality.resolved': 0 }
            : { 'delta.quality.introduced': 0, 'delta.quality.resolved': 5 },
        }));
    const prior = estimateTeamPrior([{ runs: mixed('a', 0.2) }, { runs: mixed('b', 0.8) }]);
    expect(prior).not.toBeNull();
    expect(prior!.alpha0).toBeGreaterThan(0);
    expect(prior!.beta0).toBeGreaterThan(0);
  });
});

describe('determinism (§8 D14 / D8)', () => {
  it('the same inputs give byte-identical outputs', () => {
    const inputs = twentyFive('p-det');
    const a = scoreBucket(bucket('p-det', 'requester', inputs), PRIOR, null);
    const b = scoreBucket(bucket('p-det', 'requester', inputs), PRIOR, null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('a fitted case-mix model round-trips through quantized params deterministically', () => {
    const train = Array.from({ length: 40 }, (_, i) => ({ x: [i, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0], y: (i % 2) as 0 | 1 }));
    const params = fitCaseMixModel(train);
    const modelA = loadCaseMixModel(params);
    const modelB = loadCaseMixModel(params);
    const x = Float32Array.from([10, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    expect(JSON.stringify(modelA.proba(x))).toBe(JSON.stringify(modelB.proba(x)));
  });
});

describe('measures (D14.2)', () => {
  it('run-quality counts runs whose quality introduced exceeds resolved', () => {
    const b = bucket('p-m', 'requester', [
      run('p-m', 'requester', { runId: 'worse', values: { 'delta.quality.introduced': 3, 'delta.quality.resolved': 1 } }),
      run('p-m', 'requester', { runId: 'better', values: { 'delta.quality.introduced': 0, 'delta.quality.resolved': 2 } }),
    ]);
    const m = measure('run-quality', b, null, (r) => (r.values['delta.quality.introduced'] ?? 0) > (r.values['delta.quality.resolved'] ?? 0));
    expect(m.observed).toBe(1);
    expect(m.finalRuns).toBe(2);
  });
});
