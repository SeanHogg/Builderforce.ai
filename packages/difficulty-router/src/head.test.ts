import { describe, expect, it } from 'vitest';
import { difficultyFeatureDim, featurize, vocabularyOf, type DifficultyFeatures } from './features.js';
import {
  DIFFICULTY_POLICY,
  binaryFromSoftmaxParams,
  headTrusted,
  parseDifficultyHead,
  predictWeakFailure,
  skipWeakAttempt,
  trainLogistic,
  type DifficultyExample,
  type DifficultyHead,
  type LogisticTrainer,
} from './head.js';

/**
 * The D2 head's load-bearing rules:
 *  - cold start / untrusted head never skips (today's behaviour);
 *  - the stored binary head is EXACTLY the softmax's class-1 output;
 *  - training goes through the injected trainer, never a second one;
 *  - a cached value of the wrong shape reads as no head.
 */

const easy: DifficultyFeatures = { actionType: 'docs', role: 'code', promptTokens: 400, toolCount: 4, turnIndex: 0 };
const hard: DifficultyFeatures = { actionType: 'refactor', role: 'code', promptTokens: 60_000, toolCount: 30, turnIndex: 20, repoFileCount: 8_000 };

function trustedHead(over: Partial<DifficultyHead> = {}): DifficultyHead {
  const vocab = { actionTypes: ['docs', 'refactor'], roles: ['code'] };
  const dim = difficultyFeatureDim(vocab);
  const w = new Array<number>(dim).fill(0);
  w[1] = 6; // refactor
  return { v: 1, vocab, w, b: -3, samples: 80, holdoutLoss: 0.4, trainedAt: 1, ...over };
}

describe('featurize', () => {
  it('one-hots against the head vocabulary; an unseen value encodes as zeros', () => {
    const vocab = { actionTypes: ['bugfix', 'docs'], roles: ['code', 'plan'] };
    const x = featurize({ ...easy, actionType: 'never-seen' }, vocab);
    expect(x).toHaveLength(difficultyFeatureDim(vocab));
    expect(x.slice(0, 4)).toEqual([0, 0, 1, 0]);
  });

  it('keeps only frequent categorical values, in a stable order', () => {
    const rows = [...Array(6).fill(easy), ...Array(2).fill({ ...easy, actionType: 'sql' })] as DifficultyFeatures[];
    expect(vocabularyOf(rows, { minCount: 5, max: 16 })).toEqual({ actionTypes: ['docs'], roles: ['code'] });
  });
});

describe('binaryFromSoftmaxParams', () => {
  it('reduces a 2-class softmax to the sigmoid of the class-1 margin', () => {
    // dim 2: W0=[1,2], W1=[4,0], b=[0.5,-1]
    const { w, b } = binaryFromSoftmaxParams([1, 2, 4, 0, 0.5, -1], 2);
    expect(w).toEqual([3, -2]);
    expect(b).toBe(-1.5);
    const x = [0.3, 0.7];
    const l0 = 1 * 0.3 + 2 * 0.7 + 0.5;
    const l1 = 4 * 0.3 + 0 * 0.7 - 1;
    const softmax1 = Math.exp(l1) / (Math.exp(l0) + Math.exp(l1));
    const sigmoid = 1 / (1 + Math.exp(-(w[0]! * x[0]! + w[1]! * x[1]! + b)));
    expect(sigmoid).toBeCloseTo(softmax1, 10);
  });

  it('refuses params of the wrong length', () => {
    expect(() => binaryFromSoftmaxParams([1, 2, 3], 2)).toThrow();
  });
});

describe('the skip decision', () => {
  it('never skips without a trusted head', () => {
    expect(skipWeakAttempt(null, hard)).toBe(false);
    expect(skipWeakAttempt(trustedHead({ samples: 10 }), hard, { random: () => 0.99 })).toBe(false);
    expect(skipWeakAttempt(trustedHead({ holdoutLoss: Math.LN2 }), hard, { random: () => 0.99 })).toBe(false);
    expect(skipWeakAttempt(trustedHead({ holdoutLoss: null }), hard, { random: () => 0.99 })).toBe(false);
  });

  it('skips only above the threshold, and still explores a share', () => {
    const head = trustedHead();
    expect(headTrusted(head)).toBe(true);
    expect(predictWeakFailure(head, hard)).toBeGreaterThan(DIFFICULTY_POLICY.skipAbove);
    expect(predictWeakFailure(head, easy)).toBeLessThan(DIFFICULTY_POLICY.skipAbove);
    expect(skipWeakAttempt(head, hard, { random: () => 0.99 })).toBe(true);
    expect(skipWeakAttempt(head, hard, { random: () => 0.01 })).toBe(false);
    expect(skipWeakAttempt(head, easy, { random: () => 0.99 })).toBe(false);
  });
});

describe('trainLogistic', () => {
  const examples: DifficultyExample[] = Array.from({ length: 60 }, (_, i) =>
    i % 2 === 0 ? { features: easy, failed: false } : { features: hard, failed: true });

  it('stays untrained below minSamples without calling the trainer', async () => {
    let called = false;
    const trainer: LogisticTrainer = async () => {
      called = true;
      return null;
    };
    expect(await trainLogistic(examples.slice(0, 10), trainer)).toBeNull();
    expect(called).toBe(false);
  });

  it('hands the injected trainer engine-convention samples and stores the binary head', async () => {
    let seen: { dim: number; n: number; firstY: number } | null = null;
    const trainer: LogisticTrainer = async (samples, spec) => {
      seen = { dim: spec.dim, n: samples.length, firstY: samples[1]!.y };
      return { params: new Array(2 * spec.dim + 2).fill(0), holdoutLoss: 0.3, samples: samples.length };
    };
    const head = await trainLogistic(examples, trainer, { now: () => 42 });
    expect(seen).toEqual({ dim: difficultyFeatureDim(head!.vocab), n: 60, firstY: 1 });
    expect(head).toMatchObject({ v: 1, samples: 60, holdoutLoss: 0.3, trainedAt: 42, b: 0 });
    expect(head!.vocab).toEqual({ actionTypes: ['docs', 'refactor'], roles: ['code'] });
    expect(parseDifficultyHead(JSON.parse(JSON.stringify(head)))).toEqual(head);
  });
});

describe('parseDifficultyHead', () => {
  it('reads a malformed or other-version value as no head', () => {
    expect(parseDifficultyHead(undefined)).toBeNull();
    expect(parseDifficultyHead({ ...trustedHead(), v: 2 })).toBeNull();
    expect(parseDifficultyHead({ ...trustedHead(), w: [1, 2] })).toBeNull();
  });
});
