import { describe, expect, it } from 'vitest';
import type { CatalogView } from '@builderforce/model-catalog';
import { orderPoolForWorkload, rankConnectedForRole } from './index.js';

const VIEW: CatalogView = {
  vendorOf: (m) => (m === 'a' ? 'va' : m === 'b' ? 'vb' : 'vc'),
  tierOf: () => 'STANDARD',
};

describe('exploration is threaded through the router (D3)', () => {
  const stats = [
    { model: 'a', n: 20, avgScore: 0.9, avgCostMc: 1 },
    { model: 'b', n: 20, avgScore: 0.5, avgCostMc: 1 },
  ];
  const base = { arcStage: undefined, inputTokens: 1_000, outputTokens: 100 };

  it('without explore the learned order is deterministic', () => {
    expect(rankConnectedForRole(['b', 'a', 'cold'], VIEW, { role: 'code', stats })[0]).toBe('a');
    expect(orderPoolForWorkload(['b', 'a', 'cold'], { ...base, role: 'code' }, VIEW, { stats })[0]).toBe('a');
  });

  it('a cold-slot draw (rng below the share) leads with the cold model on both paths', () => {
    const explore = { rng: () => 0, coldShare: 0.05 };
    expect(rankConnectedForRole(['b', 'a', 'cold'], VIEW, { role: 'code', stats, explore })[0]).toBe('cold');
    expect(orderPoolForWorkload(['b', 'a', 'cold'], { ...base, role: 'code' }, VIEW, { stats, explore })[0]).toBe('cold');
  });

  it('a role that keeps the tenant order never explores', () => {
    const explore = { rng: () => 0, coldShare: 1 };
    expect(rankConnectedForRole(['b', 'a', 'cold'], VIEW, { role: 'plan', stats, explore })).toEqual(['b', 'a', 'cold']);
  });
});
