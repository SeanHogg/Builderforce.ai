/**
 * The difficulty head: P(the weak model's attempt fails its verifier), the policy that
 * decides when that answer is trusted enough to skip the weak attempt, and training
 * through an INJECTED trainer.
 *
 * There is one logistic trainer in the platform — the engine's (`trainMlTask`, with its
 * held-out tail, `minSamples` and refit-on-all). The api hands it in as a
 * {@link LogisticTrainer}; this module only builds the samples, and reduces the fitted
 * two-class softmax to the binary head it stores: for classes (passes, fails),
 * `P(fails) = σ((W₁ − W₀)·x + (b₁ − b₀))`, which is exactly the softmax's class-1 output.
 *
 * Cold start is today's behaviour: no head, too few samples, or a held-out loss no better
 * than a coin (ln 2 nats) and the weak model is always tried.
 */

import {
  difficultyFeatureDim,
  featurize,
  vocabularyOf,
  type DifficultyFeatures,
  type DifficultyVocabulary,
} from './features.js';

/** Bumped when the feature layout changes, so a stored head of the old shape is orphaned. */
export const DIFFICULTY_HEAD_VERSION = 1;

/** The router's thresholds — data, not branches. */
export interface DifficultyPolicy {
  /** Fewer training rows than this and no head is fitted (and a stored one is not trusted). */
  readonly minSamples: number;
  /** A head acts only when its held-out loss is below this (ln 2 = a coin). */
  readonly maxHoldoutLoss: number;
  /** Skip the weak attempt only when P(weak fails) is above this. */
  readonly skipAbove: number;
  /**
   * Of the steps the head would skip, the share still tried on the weak model. Without
   * it a skipped step never yields a weak outcome, so a head that learned "fails" could
   * never unlearn it (the same reason as the local-success router's explore share).
   */
  readonly explore: number;
  /** Share of the newest rows held out to measure the head. */
  readonly holdoutFraction: number;
  /** Vocabulary: a categorical value needs this many rows for a slot of its own … */
  readonly vocabMinCount: number;
  /** … and each field keeps at most this many slots. */
  readonly vocabMax: number;
}

export const DIFFICULTY_POLICY: DifficultyPolicy = {
  minSamples: 50,
  maxHoldoutLoss: Math.LN2,
  skipAbove: 0.75,
  explore: 0.1,
  holdoutFraction: 0.2,
  vocabMinCount: 5,
  vocabMax: 16,
};

/**
 * {@link DIFFICULTY_POLICY} with a caller's overrides — the thresholds are options with
 * the shipped constants as defaults. An override that is not a finite number in its
 * field's range (a share or probability in [0, 1], a count ≥ 0, a loss > 0) is ignored,
 * so a bad setting can never switch the router into skipping everything.
 */
export function difficultyPolicyWith(overrides: Partial<DifficultyPolicy> = {}, base: DifficultyPolicy = DIFFICULTY_POLICY): DifficultyPolicy {
  const share = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : d);
  const count = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : d);
  return {
    minSamples: count(overrides.minSamples, base.minSamples),
    maxHoldoutLoss: typeof overrides.maxHoldoutLoss === 'number' && Number.isFinite(overrides.maxHoldoutLoss) && overrides.maxHoldoutLoss > 0
      ? overrides.maxHoldoutLoss
      : base.maxHoldoutLoss,
    skipAbove: share(overrides.skipAbove, base.skipAbove),
    explore: share(overrides.explore, base.explore),
    holdoutFraction: share(overrides.holdoutFraction, base.holdoutFraction),
    vocabMinCount: count(overrides.vocabMinCount, base.vocabMinCount),
    vocabMax: count(overrides.vocabMax, base.vocabMax),
  };
}

/** A trained head, as cached. */
export interface DifficultyHead {
  v: typeof DIFFICULTY_HEAD_VERSION;
  vocab: DifficultyVocabulary;
  /** Binary weights, index-aligned with {@link featurize}. */
  w: number[];
  b: number;
  /** Rows the final fit saw. */
  samples: number;
  /** Mean cross-entropy on the held-out tail, or null when none was held out. */
  holdoutLoss: number | null;
  /** When it was trained (ms epoch). */
  trainedAt: number;
}

/** One labelled training row: a weak attempt and whether its verifier failed it. */
export interface DifficultyExample {
  features: DifficultyFeatures;
  failed: boolean;
  weight?: number;
}

/** A sample in feature space, in the engine's label convention (class 1 = fails). */
export interface LogisticSample {
  x: number[];
  y: 0 | 1;
  weight?: number;
}

/** What an injected trainer returns: the softmax's flat params `[W (classes × dim, row-major), b (classes)]`. */
export interface LogisticFit {
  params: ArrayLike<number>;
  holdoutLoss: number | null;
  samples: number;
}

/** The ONE trainer, injected. Returns null when it declines to fit (too few rows). */
export type LogisticTrainer = (
  samples: readonly LogisticSample[],
  spec: { classes: 2; dim: number; minSamples: number; holdoutFraction: number },
) => Promise<LogisticFit | null>;

/** Reduce a two-class softmax's flat params to the binary `(w, b)` of class 1. */
export function binaryFromSoftmaxParams(params: ArrayLike<number>, dim: number): { w: number[]; b: number } {
  if (params.length !== 2 * dim + 2) {
    throw new Error(`difficulty head: expected ${2 * dim + 2} params for dim ${dim}, got ${params.length}`);
  }
  const w: number[] = [];
  for (let j = 0; j < dim; j++) w.push(Number(params[dim + j]) - Number(params[j]));
  return { w, b: Number(params[2 * dim + 1]) - Number(params[2 * dim]) };
}

/**
 * Fit a head on `examples` (oldest first — the trainer holds out the newest tail).
 * Null below the policy's `minSamples`, or when the trainer declines.
 */
export async function trainLogistic(
  examples: readonly DifficultyExample[],
  trainer: LogisticTrainer,
  opts: { policy?: DifficultyPolicy; now?: () => number } = {},
): Promise<DifficultyHead | null> {
  const policy = opts.policy ?? DIFFICULTY_POLICY;
  if (examples.length < policy.minSamples) return null;
  const vocab = vocabularyOf(examples.map((e) => e.features), { minCount: policy.vocabMinCount, max: policy.vocabMax });
  const dim = difficultyFeatureDim(vocab);
  const samples: LogisticSample[] = examples.map((e) => ({
    x: featurize(e.features, vocab),
    y: e.failed ? 1 : 0,
    ...(e.weight !== undefined ? { weight: e.weight } : {}),
  }));
  const fit = await trainer(samples, { classes: 2, dim, minSamples: policy.minSamples, holdoutFraction: policy.holdoutFraction });
  if (!fit) return null;
  const { w, b } = binaryFromSoftmaxParams(fit.params, dim);
  return {
    v: DIFFICULTY_HEAD_VERSION,
    vocab,
    w,
    b,
    samples: fit.samples,
    holdoutLoss: fit.holdoutLoss,
    trainedAt: (opts.now ?? Date.now)(),
  };
}

function sigmoid(z: number): number {
  if (z >= 0) return 1 / (1 + Math.exp(-z));
  const e = Math.exp(z);
  return e / (1 + e);
}

/** P(the weak model's attempt at `f` fails). 0.5 (no information) for a head of the wrong shape. */
export function predictWeakFailure(head: DifficultyHead, f: DifficultyFeatures): number {
  const x = featurize(f, head.vocab);
  if (x.length !== head.w.length) return 0.5;
  let z = head.b;
  for (let i = 0; i < x.length; i++) z += head.w[i]! * x[i]!;
  return sigmoid(z);
}

/** Enough rows, and a held-out loss that beats a coin. */
export function headTrusted(head: DifficultyHead | null | undefined, policy: DifficultyPolicy = DIFFICULTY_POLICY): head is DifficultyHead {
  return !!head
    && head.samples >= policy.minSamples
    && typeof head.holdoutLoss === 'number'
    && Number.isFinite(head.holdoutLoss)
    && head.holdoutLoss < policy.maxHoldoutLoss;
}

/** THE decision: skip the weak attempt? False for a cold or untrusted head. */
export function skipWeakAttempt(
  head: DifficultyHead | null | undefined,
  f: DifficultyFeatures,
  opts: { policy?: DifficultyPolicy; random?: () => number } = {},
): boolean {
  const policy = opts.policy ?? DIFFICULTY_POLICY;
  if (!headTrusted(head, policy)) return false;
  if (predictWeakFailure(head, f) <= policy.skipAbove) return false;
  return (opts.random ?? Math.random)() >= policy.explore;
}

function stringArray(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((s) => typeof s === 'string') ? (v as string[]) : null;
}

/** A cached head, validated; null for none, another version, or a malformed value. */
export function parseDifficultyHead(raw: unknown): DifficultyHead | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Partial<DifficultyHead> & { vocab?: Partial<DifficultyVocabulary> };
  if (h.v !== DIFFICULTY_HEAD_VERSION) return null;
  const actionTypes = stringArray(h.vocab?.actionTypes);
  const roles = stringArray(h.vocab?.roles);
  if (!actionTypes || !roles) return null;
  const vocab = { actionTypes, roles };
  if (!Array.isArray(h.w) || h.w.length !== difficultyFeatureDim(vocab) || !h.w.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  if (typeof h.b !== 'number' || !Number.isFinite(h.b) || typeof h.samples !== 'number') return null;
  const holdoutLoss = typeof h.holdoutLoss === 'number' ? h.holdoutLoss : null;
  return { v: DIFFICULTY_HEAD_VERSION, vocab, w: h.w, b: h.b, samples: h.samples, holdoutLoss, trainedAt: typeof h.trainedAt === 'number' ? h.trainedAt : 0 };
}
