import { describe, expect, it } from 'vitest';
import type { CatalogView, ModelPrice, ModelTier } from '@builderforce/model-catalog';
import {
  expectedCostUsd,
  isCostFirstObjective,
  orderByExpectedCost,
  orderForRole,
  orderPoolForWorkload,
  rankConnectedForRole,
  resolveRoleObjective,
} from './index.js';

interface Spec { vendor: string; tier?: ModelTier; price?: ModelPrice; local?: boolean }

function viewOf(specs: Record<string, Spec>): CatalogView {
  return {
    vendorOf: (m) => specs[m]?.vendor ?? 'unknown',
    tierOf: (m) => specs[m]?.tier,
    priceOf: (m) => specs[m]?.price,
    residencyOf: (m) => (specs[m]?.local ? 'local' : 'cloud'),
  };
}

const VIEW = viewOf({
  opus: { vendor: 'anthropic', tier: 'ULTRA', price: { input: 15e-6, output: 75e-6 } },
  sonnet: { vendor: 'anthropic', tier: 'PREMIUM', price: { input: 3e-6, output: 15e-6 } },
  flash: { vendor: 'google', tier: 'STANDARD', price: { input: 0.1e-6, output: 0.4e-6 } },
  mini: { vendor: 'openai', tier: 'STANDARD', price: { input: 0.4e-6, output: 1.6e-6 } },
  nemo: { vendor: 'nvidia', tier: 'FREE' },
  qwen3: { vendor: 'bfi', local: true },
  mystery: { vendor: 'x' },
});

describe('objective', () => {
  it('code is strongest-first, explore cheapest-first, plan balanced', () => {
    expect(resolveRoleObjective('code')).toBe(1);
    expect(resolveRoleObjective('plan')).toBe(0);
    expect(isCostFirstObjective(resolveRoleObjective('explore'))).toBe(true);
    expect(isCostFirstObjective(resolveRoleObjective('verify'))).toBe(true);
    expect(isCostFirstObjective(resolveRoleObjective('plan'))).toBe(false);
  });
});

describe('orderForRole', () => {
  const given = ['mini', 'flash', 'opus', 'sonnet'];

  it('a coding turn leads with the strongest tier', () => {
    expect(orderForRole(given, 1, VIEW)).toEqual(['opus', 'sonnet', 'mini', 'flash']);
  });

  it('a cost-first turn leads with the cheapest tier, then the cheaper price within it', () => {
    expect(orderForRole(given, -1, VIEW)).toEqual(['flash', 'mini', 'sonnet', 'opus']);
  });

  it('a balanced turn keeps the given order', () => {
    expect(orderForRole(given, 0, VIEW)).toEqual(given);
  });

  it('a failing vendor never leads', () => {
    expect(orderForRole(given, 1, VIEW, new Set(['anthropic']))[0]).toBe('mini');
  });
});

describe('rankConnectedForRole', () => {
  it('re-ranks by learned evidence only where the role lets the system choose', () => {
    const stats = [
      { model: 'sonnet', n: 20, avgScore: 0.95, avgCostMc: 10 },
      { model: 'opus', n: 20, avgScore: 0.5, avgCostMc: 50 },
    ];
    expect(rankConnectedForRole(['opus', 'sonnet'], VIEW, { role: 'code', stats })[0]).toBe('sonnet');
    expect(rankConnectedForRole(['opus', 'sonnet'], VIEW, { role: 'plan', stats })).toEqual(['opus', 'sonnet']);
  });
});

describe('expected cost', () => {
  const work = { inputTokens: 10_000, outputTokens: 1_000 };

  it('local and free cost nothing, unknown is unknown', () => {
    expect(expectedCostUsd('qwen3', work, VIEW)).toBe(0);
    expect(expectedCostUsd('nemo', work, VIEW)).toBe(0);
    expect(expectedCostUsd('mystery', work, VIEW)).toBeUndefined();
    expect(expectedCostUsd('sonnet', work, VIEW)).toBeCloseTo(0.045, 9);
  });

  it('orders cheapest first and never lets an unknown price lead', () => {
    expect(orderByExpectedCost(['mystery', 'opus', 'flash', 'qwen3', 'nemo'], work, VIEW))
      .toEqual(['qwen3', 'nemo', 'flash', 'opus', 'mystery']);
  });
});

describe('orderPoolForWorkload', () => {
  const pool = ['nemo', 'sonnet', 'mini', 'flash'];
  const base = { arcStage: undefined, inputTokens: 5_000, outputTokens: 800 };

  it('reorders the paid models by expected cost for a cost-first role', () => {
    expect(orderPoolForWorkload(pool, { ...base, role: 'explore' }, VIEW)).toEqual(['nemo', 'flash', 'mini', 'sonnet']);
  });

  it('leaves the pool untouched for any other role', () => {
    expect(orderPoolForWorkload(pool, { ...base, role: 'code' }, VIEW)).toEqual(pool);
    expect(orderPoolForWorkload(pool, { ...base, role: undefined }, VIEW)).toEqual(pool);
  });
});
