import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DIFFICULTY_POLICY, difficultyFeatureDim, type DifficultyFeatures, type DifficultyHead } from '@builderforce/difficulty-router';

const mocks = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => mocks.kv.get(key) ?? null,
  getOrSetCached: async (_env: unknown, key: string, loader: () => Promise<unknown>) => mocks.kv.get(key) ?? loader(),
}));

const { difficultyHeadKey, difficultyPolicyFromEnv, shouldSkipWeakAttempt } = await import('./difficultyGate');

/** The D2 thresholds come from the Worker env (`DIFFICULTY_SKIP_ABOVE` / `DIFFICULTY_EXPLORE`). */

const ON = { COST_LEVER_D2_DIFFICULTY_ROUTER: 'on' };
const hard: DifficultyFeatures = { actionType: 'refactor', role: 'code', promptTokens: 80_000, toolCount: 30, turnIndex: 25 };

function head(): DifficultyHead {
  const vocab = { actionTypes: ['docs', 'refactor'], roles: ['code'] };
  const w = new Array<number>(difficultyFeatureDim(vocab)).fill(0);
  w[1] = 6;
  return { v: 1, vocab, w, b: -3, samples: 120, holdoutLoss: 0.35, trainedAt: 1 };
}

beforeEach(() => {
  mocks.kv.clear();
  mocks.kv.set(difficultyHeadKey({ tenantId: 7 }), head());
});

describe('difficultyPolicyFromEnv', () => {
  it('is the shipped policy when nothing is set, or the values are bad', () => {
    expect(difficultyPolicyFromEnv({})).toEqual(DIFFICULTY_POLICY);
    expect(difficultyPolicyFromEnv(undefined)).toEqual(DIFFICULTY_POLICY);
    expect(difficultyPolicyFromEnv({ DIFFICULTY_SKIP_ABOVE: 'lots', DIFFICULTY_EXPLORE: '7' })).toEqual(DIFFICULTY_POLICY);
  });

  it('reads the two thresholds from the env strings', () => {
    const p = difficultyPolicyFromEnv({ DIFFICULTY_SKIP_ABOVE: '0.9', DIFFICULTY_EXPLORE: '0.25' });
    expect(p.skipAbove).toBe(0.9);
    expect(p.explore).toBe(0.25);
    expect(p.minSamples).toBe(DIFFICULTY_POLICY.minSamples);
  });
});

describe('shouldSkipWeakAttempt — env thresholds', () => {
  const random = () => 0.6;

  it('the shipped explore share (0.1) lets a confident skip through', async () => {
    expect(await shouldSkipWeakAttempt(ON, 7, hard, { random })).toBe(true);
  });

  it('an env explore share above the draw keeps trying the weak model', async () => {
    expect(await shouldSkipWeakAttempt({ ...ON, DIFFICULTY_EXPLORE: '0.9' }, 7, hard, { random })).toBe(false);
  });

  it('an env skip threshold of 1 never skips', async () => {
    expect(await shouldSkipWeakAttempt({ ...ON, DIFFICULTY_SKIP_ABOVE: '1' }, 7, hard, { random })).toBe(false);
  });

  it("a caller's policy still wins over the env", async () => {
    expect(await shouldSkipWeakAttempt({ ...ON, DIFFICULTY_EXPLORE: '0.9' }, 7, hard, { random, policy: DIFFICULTY_POLICY })).toBe(true);
  });
});
