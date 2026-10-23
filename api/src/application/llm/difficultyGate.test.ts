import { beforeEach, describe, expect, it, vi } from 'vitest';
import { difficultyFeatureDim, type DifficultyFeatures, type DifficultyHead } from '@builderforce/difficulty-router';

const mocks = vi.hoisted(() => ({ kv: new Map<string, unknown>(), peeks: [] as string[], loads: 0 }));

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => {
    mocks.peeks.push(key);
    return mocks.kv.get(key) ?? null;
  },
  getOrSetCached: async (_env: unknown, key: string, loader: () => Promise<unknown>) => {
    if (mocks.kv.has(key)) return mocks.kv.get(key);
    mocks.loads++;
    const value = await loader();
    mocks.kv.set(key, value);
    return value;
  },
}));

const { difficultyHeadKey, recordCascadeOutcome, shouldSkipWeakAttempt, weakPassRate, weakPassRateKey } = await import('./difficultyGate');

/**
 * The D2 gate's contract: lever off / cold / untrusted ⇒ never skip; the hot path reads
 * only the cached head (tenant first, then global); recording never throws.
 */

const ON = { COST_LEVER_D2_DIFFICULTY_ROUTER: 'on' };
const hard: DifficultyFeatures = { actionType: 'refactor', role: 'code', promptTokens: 80_000, toolCount: 30, turnIndex: 25 };
const easy: DifficultyFeatures = { actionType: 'docs', role: 'code', promptTokens: 300, toolCount: 3, turnIndex: 0 };

function head(over: Partial<DifficultyHead> = {}): DifficultyHead {
  const vocab = { actionTypes: ['docs', 'refactor'], roles: ['code'] };
  const w = new Array<number>(difficultyFeatureDim(vocab)).fill(0);
  w[1] = 6;
  return { v: 1, vocab, w, b: -3, samples: 120, holdoutLoss: 0.35, trainedAt: 1, ...over };
}

const noExplore = { random: () => 0.99 };

beforeEach(() => {
  mocks.kv.clear();
  mocks.peeks.length = 0;
});

describe('shouldSkipWeakAttempt', () => {
  it('is false with the lever off, without reading the cache', async () => {
    mocks.kv.set(difficultyHeadKey({ tenantId: 7 }), head());
    expect(await shouldSkipWeakAttempt({ COST_LEVER_D2_DIFFICULTY_ROUTER: 'off' }, 7, hard, noExplore)).toBe(false);
    expect(mocks.peeks).toEqual([]);
  });

  it('is false on a cold start (no cached head anywhere)', async () => {
    expect(await shouldSkipWeakAttempt(ON, 7, hard, noExplore)).toBe(false);
  });

  it("skips a confidently-failing step on the tenant's own trusted head, not an easy one", async () => {
    mocks.kv.set(difficultyHeadKey({ tenantId: 7 }), head());
    expect(await shouldSkipWeakAttempt(ON, 7, hard, noExplore)).toBe(true);
    expect(await shouldSkipWeakAttempt(ON, 7, easy, noExplore)).toBe(false);
  });

  it('falls back to the global head when the tenant head is untrusted', async () => {
    mocks.kv.set(difficultyHeadKey({ tenantId: 7 }), head({ samples: 12 }));
    mocks.kv.set(difficultyHeadKey('global'), head());
    expect(await shouldSkipWeakAttempt(ON, 7, hard, noExplore)).toBe(true);
    expect(mocks.peeks).toEqual([difficultyHeadKey({ tenantId: 7 }), difficultyHeadKey('global')]);
  });

  it('never skips on a head whose held-out loss does not beat a coin', async () => {
    mocks.kv.set(difficultyHeadKey('global'), head({ holdoutLoss: 0.7 }));
    expect(await shouldSkipWeakAttempt(ON, null, hard, noExplore)).toBe(false);
  });
});

describe('recordCascadeOutcome', () => {
  const outcome = {
    tenantId: 7,
    executionId: 'exec-1',
    actionType: 'refactor',
    role: 'code',
    weakModel: 'qwen/qwen3-coder',
    passed: false,
    verifier: 'tests',
    features: hard,
  };

  it('writes one cascade_outcomes row', async () => {
    const values = vi.fn(async () => undefined);
    const db = { insert: vi.fn(() => ({ values })) };
    await recordCascadeOutcome({}, db, outcome);
    expect(db.insert).toHaveBeenCalledOnce();
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 7, executionId: 'exec-1', passed: false, verifier: 'tests', features: hard }));
  });

  it('reports and resolves when the write fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = { insert: () => ({ values: async () => { throw new Error('db down'); } }) };
    await expect(recordCascadeOutcome({}, db, outcome)).resolves.toBeUndefined();
    error.mockRestore();
  });
});

describe('weakPassRate — the D2 prior', () => {
  const dbReturning = (row: { total: number; passed: number } | undefined) => {
    const where = vi.fn(async () => (row ? [row] : []));
    return { db: { select: () => ({ from: () => ({ where }) }) }, where };
  };
  beforeEach(() => { mocks.kv.clear(); mocks.loads = 0; });

  it('is the passed share of the tenant action type over the window, read through the cache', async () => {
    const { db, where } = dbReturning({ total: 8, passed: 6 });
    expect(await weakPassRate({}, db, 7, 'refactor')).toBeCloseTo(0.75);
    expect(await weakPassRate({}, db, 7, 'refactor')).toBeCloseTo(0.75);
    expect(where).toHaveBeenCalledOnce();
    expect(mocks.kv.has(weakPassRateKey(7, 'refactor'))).toBe(true);
  });

  it('is undefined on too little evidence, and the empty verdict is cached too', async () => {
    const { db, where } = dbReturning({ total: 2, passed: 2 });
    expect(await weakPassRate({}, db, 7, 'docs')).toBeUndefined();
    expect(await weakPassRate({}, db, 7, 'docs')).toBeUndefined();
    expect(where).toHaveBeenCalledOnce();
  });

  it('reports a failed read and leaves the prior unset', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = { select: () => ({ from: () => ({ where: async () => { throw new Error('db down'); } }) }) };
    await expect(weakPassRate({}, db, 7, 'bugfix')).resolves.toBeUndefined();
    error.mockRestore();
  });
});
