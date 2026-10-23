import { beforeEach, describe, expect, it, vi } from 'vitest';
import { headTrusted, parseDifficultyHead, predictWeakFailure, trainLogistic, type DifficultyExample, type DifficultyFeatures } from '@builderforce/difficulty-router';

const mocks = vi.hoisted(() => ({ kv: new Map<string, unknown>() }));

vi.mock('../../infrastructure/cache/readThroughCache', () => ({
  peekCached: async (_env: unknown, key: string) => mocks.kv.get(key) ?? null,
  setCached: async (_env: unknown, key: string, value: unknown) => {
    mocks.kv.set(key, value);
  },
}));

const { asDifficultyFeatures, engineLogisticTrainer, runDifficultyTraining } = await import('./difficultyTraining');
const { difficultyHeadKey } = await import('./difficultyGate');

/**
 * The training sweep: the engine's ONE trainer fits the head (held-out tail, minSamples),
 * a tenant with enough rows gets its own cached head, and every tenant's rows feed the
 * global fallback.
 */

const easy: DifficultyFeatures = { actionType: 'docs', role: 'code', promptTokens: 300, toolCount: 3, turnIndex: 0 };
const hard: DifficultyFeatures = { actionType: 'refactor', role: 'code', promptTokens: 80_000, toolCount: 30, turnIndex: 25 };

function separable(n: number): DifficultyExample[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? { features: easy, failed: false } : { features: hard, failed: true }));
}

beforeEach(() => mocks.kv.clear());

describe('engineLogisticTrainer', () => {
  it('fits a head through the engine that beats a coin on its held-out tail and ranks hard over easy', async () => {
    const head = await trainLogistic(separable(80), engineLogisticTrainer);
    expect(head).not.toBeNull();
    expect(headTrusted(head)).toBe(true);
    expect(predictWeakFailure(head!, hard)).toBeGreaterThan(0.75);
    expect(predictWeakFailure(head!, easy)).toBeLessThan(0.5);
  });
});

describe('asDifficultyFeatures', () => {
  it('accepts a stored object or JSON string and rejects a malformed row', () => {
    expect(asDifficultyFeatures(hard)).toEqual(hard);
    expect(asDifficultyFeatures(JSON.stringify({ ...easy, repoFileCount: 12 }))).toEqual({ ...easy, repoFileCount: 12 });
    expect(asDifficultyFeatures({ actionType: 'docs' })).toBeNull();
    expect(asDifficultyFeatures('not json')).toBeNull();
  });
});

describe('runDifficultyTraining', () => {
  it('caches a head for a tenant with enough rows and a global head over all tenants', async () => {
    const rows = [
      ...separable(60).map((e) => ({ tenant_id: 1, passed: !e.failed, features: e.features })),
      ...separable(20).map((e) => ({ tenant_id: 2, passed: !e.failed, features: e.features })),
      { tenant_id: 2, passed: true, features: { broken: true } },
    ];
    const db = { execute: vi.fn(async () => ({ rows })) };
    const r = await runDifficultyTraining(undefined, db as never);
    expect(r).toEqual({ rows: 80, skipped: 1, tenantHeads: 1, globalHead: true });
    expect(parseDifficultyHead(mocks.kv.get(difficultyHeadKey({ tenantId: 1 })))).not.toBeNull();
    expect(mocks.kv.has(difficultyHeadKey({ tenantId: 2 }))).toBe(false);
    expect(parseDifficultyHead(mocks.kv.get(difficultyHeadKey('global')))?.samples).toBe(80);
  });
});
