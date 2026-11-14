/**
 * personScore.ts — PRD 41 §D14 / WS22: per-person, per-role quality scores derived
 * DETERMINISTICALLY from run-delta outcomes and WS16 labels, risk-adjusted by indirect
 * standardization (observed ÷ expected) and shrunk toward the team with a Gamma–Poisson
 * empirical-Bayes posterior.
 *
 * PURE. Every function takes rows and returns rows: no database, no clock, no randomness.
 * The estimator maths is IMPORTED from `@seanhogg/builderforce-memory/stats` (the D13 one
 * home) — never re-implemented. The case-mix logistic head is the memory-engine
 * `LogisticModel` (float64 softmax, `importParams`/`exportParams`), fitted offline and
 * stored as quantized weights; inference rehydrates it with `CASE_MIX_FEATURE_COUNT`.
 *
 * D0: a score never sets or changes a verdict — it is a predicted measure that ADVISES.
 */

import { fitLogistic, LogisticModel } from '@seanhogg/builderforce-memory-engine';
import {
  gammaPoissonPosterior,
  garwoodPoissonInterval,
  gammaQuantile,
} from '@seanhogg/builderforce-memory/stats';

// ─── Roles (D14.1) ───────────────────────────────────────────────────────────

export const PERSON_SCORE_ROLES = ['requester', 'approver', 'reviewer', 'agent'] as const;
export type PersonScoreRole = (typeof PERSON_SCORE_ROLES)[number];

/** Which run_features people column backs each role (D14-restricted person ids). */
export const ROLE_COLUMN: Readonly<Record<PersonScoreRole, 'requesterId' | 'approverId' | 'reviewerId' | 'agentId'>> = {
  requester: 'requesterId',
  approver: 'approverId',
  reviewer: 'reviewerId',
  agent: 'agentId',
};

// ─── The case-mix model (`ml/tasks/case_mix`, D14.3) ─────────────────────────

/**
 * The change/context features the case-mix model may use — every factor OUTSIDE the
 * scored person's control in their role (size, entropy, centrality, entry points, churn,
 * layer and dimension flags). It deliberately EXCLUDES the scored person's own identity
 * and experience features (`people.*`) and the run's outcome labels, otherwise it would
 * explain away the very person effect being measured (D14.3).
 */
export const CASE_MIX_FEATURES = [
  'size.linesAdded',
  'size.linesDeleted',
  'size.filesTouched',
  'spread.entropy',
  'spread.entropyNormalized',
  'structure.centralitySum',
  'structure.centralityMax',
  'structure.entryPointsReached',
  'structure.layersTouched',
  'structure.crossPartitionEdgesChanged',
  'history.churn90d',
  'run.autonomous',
  'run.steps',
  'run.toolFailures',
  'delta.security.introduced',
  'delta.performance.introduced',
  'delta.quality.introduced',
  'delta.integrityFindings',
] as const;

export const CASE_MIX_FEATURE_COUNT = CASE_MIX_FEATURES.length;

/** Forbidden in the case-mix schema: the scored person's identity and experience features. */
const CASE_MIX_FORBIDDEN_PREFIXES = ['people.'];

/**
 * The unit test on the case-mix feature schema (D14.7): it must contain NONE of the
 * scored person's identity or experience features.
 */
export function caseMixFeaturesAreFair(): boolean {
  return CASE_MIX_FEATURES.every((id) => !CASE_MIX_FORBIDDEN_PREFIXES.some((p) => id.startsWith(p)));
}

/** A quantized case-mix logistic head: the weights/bias of a fitted two-class model. */
export interface CaseMixModelParams {
  weights: number[];
  bias: number[];
}

/** Rehydrate a stored (quantized) case-mix head into a float64 LogisticModel. */
export function loadCaseMixModel(params: CaseMixModelParams): LogisticModel {
  const model = new LogisticModel(CASE_MIX_FEATURE_COUNT, 2);
  model.importParams([...params.weights, ...params.bias]);
  return model;
}

/** Fit the case-mix head from training rows. `x` are the {@link CASE_MIX_FEATURES} values (imputed), `y` is 0/1. */
export function fitCaseMixModel(
  samples: ReadonlyArray<{ x: readonly number[]; y: 0 | 1 }>,
): CaseMixModelParams {
  const fitted = fitLogistic(
    samples.map((s) => ({ x: Float32Array.from(s.x), y: s.y })),
    { classes: 2, solver: 'irls', maxIterations: 50 },
  );
  const params = Array.from(fitted.exportParams());
  return {
    weights: params.slice(0, CASE_MIX_FEATURE_COUNT),
    bias: params.slice(CASE_MIX_FEATURE_COUNT),
  };
}

// ─── Inputs ──────────────────────────────────────────────────────────────────

/** One run's features as the scorer reads them (run_features + a security count). */
export interface PersonScoreRunInput {
  runId: string;
  repository: string;
  /** `finalizedAt` epoch ms — the scorer buckets the rolling window from these. */
  finalizedAtMs: number;
  values: Readonly<Record<string, number | null>>;
  /** The run's own security dimension introduced count (run_delta_dimensions). */
  securityIntroduced: number;
  /** Final labels only (censored rows are never scored, D14). */
  labels: ReadonlyArray<{ kind: string; value: boolean | null }>;
  /** The person id this run attributes to each role, or null when the role is absent. */
  people: Record<PersonScoreRole, string | null>;
}

/** A per-person, per-role bucket of runs the score is computed over. */
export interface PersonRoleBucket {
  personId: string;
  role: PersonScoreRole;
  runs: readonly PersonScoreRunInput[];
}

// ─── Case-mix feature vector ─────────────────────────────────────────────────

/**
 * Impute and assemble the case-mix vector for one run. Missing values are imputed at
 * fixed constants (0 = "not large / not autonomous", 0.5 = "average entropy") so the
 * vector is deterministic and machine-independent (D14.3: no internal feature scaling).
 */
export function caseMixVector(input: PersonScoreRunInput): number[] {
  const v = input.values;
  const num = (id: string): number => {
    const value = v[id];
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  };
  return [
    num('size.linesAdded'),
    num('size.linesDeleted'),
    num('size.filesTouched'),
    num('spread.entropy'),
    num('spread.entropyNormalized'),
    num('structure.centralitySum'),
    num('structure.centralityMax'),
    num('structure.entryPointsReached'),
    num('structure.layersTouched'),
    num('structure.crossPartitionEdgesChanged'),
    num('history.churn90d'),
    num('run.autonomous'),
    num('run.steps'),
    num('run.toolFailures'),
    num('delta.security.introduced'),
    num('delta.performance.introduced'),
    num('delta.quality.introduced'),
    num('delta.integrityFindings'),
  ];
}

// ─── Measures (D14.2) ────────────────────────────────────────────────────────

const isWorse = (input: PersonScoreRunInput): boolean =>
  (input.values['delta.quality.introduced'] ?? 0) > (input.values['delta.quality.resolved'] ?? 0);

const finalLabelValue = (input: PersonScoreRunInput, kind: string): boolean | null => {
  const label = input.labels.find((l) => l.kind === kind);
  return label ? label.value : null;
};

/** A rate measure over a bucket: observed count O and expected exposure E. */
export interface RateMeasure {
  id: string;
  observed: number;
  /** Σ P̂(outcome | case-mix) over the bucket's runs. */
  expected: number;
  /** Final-labelled runs in the bucket (the denominator for raw rates). */
  finalRuns: number;
}

const MIN_FINAL_RUNS = 20;

/**
 * Build the (O, E) pair for one measure over a bucket. `outcome` says whether a run
 * counted the event; `predicted` is the case-mix probability for that run (1 when no
 * model is fitted — raw rates). E is the SUM of predicted probabilities, never the count.
 */
export function measure(
  id: string,
  bucket: PersonRoleBucket,
  model: LogisticModel | null,
  outcome: (input: PersonScoreRunInput) => boolean,
): RateMeasure {
  let observed = 0;
  let expected = 0;
  let finalRuns = 0;
  for (const run of bucket.runs) {
    if (run.labels.length === 0) continue; // only final-labelled runs count (D14.2)
    finalRuns += 1;
    if (outcome(run)) observed += 1;
    if (model) {
      const p = model.proba(Float32Array.from(caseMixVector(run)))[1] ?? 0;
      expected += p;
    } else {
      expected += 1;
    }
  }
  return { id, observed, expected, finalRuns };
}

// ─── Shrinkage (D14.4) ───────────────────────────────────────────────────────

/** The team-wide Gamma prior from everyone in the same tenant and role (empirical Bayes). */
export interface TeamPrior {
  alpha0: number;
  beta0: number;
}

/**
 * Estimate the prior (α₀, β₀) from the whole tenant's role buckets by moments: α₀ = m²/v,
 * β₀ = m/v over the pooled per-bucket rates. Deterministic; returns null when there is
 * not enough signal to estimate a prior (the caller then reports insufficient-data).
 */
export function estimateTeamPrior(buckets: readonly { runs: readonly PersonScoreRunInput[] }[]): TeamPrior | null {
  const rates: number[] = [];
  for (const bucket of buckets) {
    const final = bucket.runs.filter((r) => r.labels.length > 0);
    if (final.length === 0) continue;
    const bad = final.filter((r) => (r.values['delta.quality.introduced'] ?? 0) > (r.values['delta.quality.resolved'] ?? 0)).length;
    rates.push(bad / final.length);
  }
  if (rates.length < 2) return null;
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  const variance = rates.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rates.length - 1);
  if (!(variance > 0) || !(mean > 0)) return null;
  const alpha0 = (mean * mean) / variance;
  const beta0 = mean / variance;
  return { alpha0, beta0 };
}

// ─── The score ───────────────────────────────────────────────────────────────

/** One scored measure, fully shrunk and intervalled. */
export interface ScoredMeasure extends RateMeasure {
  /** O / E, the indirectly standardized ratio (1 = as expected for the case-mix). */
  standardizedRatio: number | null;
  /** Posterior mean of λ (the shrunk rate), via Gamma–Poisson from builderforce-memory. */
  posteriorMean: number | null;
  /** 95% posterior interval on λ (Gamma quantiles), matching the inner funnel limit. */
  posteriorInterval: [number, number] | null;
  /** Exact Poisson (Garwood) 95% CI on O, divided by E — the funnel limit. */
  funnelInterval: [number, number] | null;
  /** True when the 99.8% funnel limit excludes 1 — the only call-out (D14.5). */
  outsideLimits: boolean;
}

export type PersonScore =
  | { status: 'insufficient-data'; finalRuns: number }
  | { status: 'ok'; finalRuns: number; measures: ScoredMeasure[] };

/** The 95% and 99.8% credible masses (the inner funnel limit and the call-out limit). */
const FUNNEL_95 = 0.95;
const FUNNEL_998 = 0.998;

/**
 * Score one measure for one bucket: standardize, shrink, and interval. Pure and
 * deterministic; the same inputs always give the same outputs.
 */
export function scoreMeasure(
  m: RateMeasure,
  prior: TeamPrior,
): ScoredMeasure {
  const standardizedRatio = m.expected > 0 ? m.observed / m.expected : null;

  // Gamma–Poisson empirical Bayes (D14.4): λ | data ~ Gamma(α₀ + O, β₀ + E). The
  // estimator maths is imported from builderforce-memory stats, never re-implemented.
  const post = gammaPoissonPosterior(prior.alpha0, prior.beta0, m.observed, m.expected);
  const half95 = (1 - FUNNEL_95) / 2;
  const half998 = (1 - FUNNEL_998) / 2;
  const lo95 = gammaQuantile(half95, post.alpha) / post.beta;
  const hi95 = gammaQuantile(1 - half95, post.alpha) / post.beta;
  const lo998 = gammaQuantile(half998, post.alpha) / post.beta;
  const hi998 = gammaQuantile(1 - half998, post.alpha) / post.beta;

  // Exact Poisson (Garwood) CI on O divided by E (D14.3) — the funnel limit.
  const garwood = garwoodPoissonInterval(m.observed, FUNNEL_95);
  const funnelInterval: [number, number] | null =
    m.expected > 0 ? [garwood.low / m.expected, garwood.high / m.expected] : null;

  // The funnel plot (Spiegelhalter 2005, D14.5): SR against expected volume with control
  // limits 1 ± z/√E (a Poisson SR has variance ≈ 1/E at the target). The 99.8% limit (z ≈
  // 3.09) is the ONLY call-out; the 95% limit just narrows the funnel.
  const z99 = 3.090232306167814; // Φ⁻¹(0.999)
  const halfWidth998 = m.expected > 0 ? z99 / Math.sqrt(m.expected) : null;
  const outsideLimits = standardizedRatio != null && halfWidth998 != null
    && (standardizedRatio < 1 - halfWidth998 || standardizedRatio > 1 + halfWidth998);

  void lo998;
  void hi998;

  return {
    ...m,
    standardizedRatio,
    posteriorMean: post.mean,
    posteriorInterval: [lo95, hi95],
    funnelInterval,
    outsideLimits,
  };
}

/** The eight D14.2 measures, computed for one bucket with a fitted (or absent) case-mix model. */
export function scoreBucket(
  bucket: PersonRoleBucket,
  prior: TeamPrior,
  model: LogisticModel | null,
): PersonScore {
  const finalRuns = bucket.runs.filter((r) => r.labels.length > 0).length;
  if (finalRuns < MIN_FINAL_RUNS) return { status: 'insufficient-data', finalRuns };

  const measures: RateMeasure[] = [
    measure('run-quality', bucket, model, isWorse),
    measure('followup-fix-rate', bucket, model, (r) => finalLabelValue(r, 'followup-fix') === true),
    measure('revert-rate', bucket, model, (r) => finalLabelValue(r, 'reverted') === true),
    measure('integrity-rate', bucket, model, (r) => (r.values['delta.integrityFindings'] ?? 0) > 0),
    measure('security-introductions', bucket, model, (r) => r.securityIntroduced > 0),
    measure('review-rejection-rate', bucket, model, (r) => finalLabelValue(r, 'review-rejected') === true),
    measure('approval-accuracy', bucket, model, (r) => finalLabelValue(r, 'reverted') !== true && finalLabelValue(r, 'followup-fix') !== true),
  ];
  return { status: 'ok', finalRuns, measures: measures.map((m) => scoreMeasure(m, prior)) };
}
