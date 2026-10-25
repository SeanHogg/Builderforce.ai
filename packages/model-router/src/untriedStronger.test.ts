import { describe, expect, it } from 'vitest';
import type { CatalogView, ModelTier } from '@builderforce/model-catalog';
import { orderPoolForWorkload, rankConnectedForRole } from './index.js';
import { liftUntriedStronger } from './untriedStronger.js';

const TIERS: Record<string, ModelTier> = {
  grok: 'ULTRA',
  opus: 'ULTRA',
  sonnet: 'PREMIUM',
  minimax: 'STANDARD',
  flash: 'STANDARD',
};
const VIEW: CatalogView = {
  vendorOf: (m) => m,
  tierOf: (m) => TIERS[m],
};
const proven = (model: string, n = 400) => ({ model, n, avgScore: 0.6, avgCostMc: 1 });

describe('liftUntriedStronger', () => {
  it('a coding call leads with an untried ULTRA coder over a heavily-used STANDARD model (chat #6)', () => {
    expect(rankConnectedForRole(['minimax', 'grok'], VIEW, { role: 'code', stats: [proven('minimax')] })[0]).toBe('grok');
  });

  it('measured models keep the order the evidence gave them, across tiers', () => {
    const stats = [
      { model: 'sonnet', n: 20, avgScore: 0.95, avgCostMc: 10 },
      { model: 'opus', n: 20, avgScore: 0.5, avgCostMc: 50 },
    ];
    expect(rankConnectedForRole(['opus', 'sonnet', 'flash'], VIEW, { role: 'code', stats }).slice(0, 2)).toEqual(['sonnet', 'opus']);
  });

  it('an untried model no stronger than the strongest measured one stays behind the evidence', () => {
    expect(rankConnectedForRole(['flash', 'minimax'], VIEW, { role: 'code', stats: [proven('minimax')] })[0]).toBe('minimax');
  });

  it('a stronger model the provider keeps refusing counts as measured and is not lifted', () => {
    const stats = [proven('minimax'), { model: 'grok', n: 10, avgScore: 0, avgCostMc: 0, rateLimitRate: 0.9 }];
    expect(rankConnectedForRole(['grok', 'minimax'], VIEW, { role: 'code', stats })[0]).toBe('minimax');
  });

  it('a failing vendor never leads, lifted or not', () => {
    const ordered = rankConnectedForRole(['minimax', 'grok'], VIEW, { role: 'code', stats: [proven('minimax')], demotedVendors: new Set(['grok']) });
    expect(ordered).toEqual(['minimax', 'grok']);
  });

  it('cost-first and balanced roles are untouched', () => {
    expect(liftUntriedStronger(['minimax', 'grok'], [proven('minimax')], -1, VIEW)).toEqual(['minimax', 'grok']);
    expect(liftUntriedStronger(['minimax', 'grok'], [proven('minimax')], 0, VIEW)).toEqual(['minimax', 'grok']);
  });

  it('the plan pool gets the same rule on a coding call', () => {
    const work = { arcStage: undefined, inputTokens: 1_000, outputTokens: 100 };
    expect(orderPoolForWorkload(['minimax', 'grok'], { ...work, role: 'code' }, VIEW, { stats: [proven('minimax')] })[0]).toBe('grok');
  });

  it('never adds or drops a model', () => {
    const models = ['minimax', 'flash', 'grok', 'sonnet'];
    expect([...liftUntriedStronger(models, [proven('minimax')], 1, VIEW)].sort()).toEqual([...models].sort());
  });
});
