import { describe, expect, it } from 'vitest';
import { ladderRankOf, type CatalogView, type ModelPrice, type ModelTier } from '@builderforce/model-catalog';
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
  it('code, plan and review are quality-first, verify and explore cheapest-first, chat balanced', () => {
    expect(resolveRoleObjective('code')).toBe(1);
    expect(resolveRoleObjective('plan')).toBe(1);
    expect(resolveRoleObjective('review')).toBe(1);
    expect(resolveRoleObjective('verify')).toBe(-1);
    expect(resolveRoleObjective('chat')).toBe(0);
    expect(isCostFirstObjective(resolveRoleObjective('explore'))).toBe(true);
    expect(isCostFirstObjective(resolveRoleObjective('verify'))).toBe(true);
    expect(isCostFirstObjective(resolveRoleObjective('plan'))).toBe(false);
    expect(isCostFirstObjective(resolveRoleObjective('chat'))).toBe(false);
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

describe('orderForRole — role ladders', () => {
  // Real ids, so the catalog's own ladders (`ladderRankOf`) rank them.
  const OPUS = 'claude-opus-4-8';
  const SONNET = 'claude-sonnet-5-5';
  const K3 = 'direct/kimi-code/k3';
  const KIMI = 'direct/kimi-code/kimi-for-coding';
  const GROK = 'xai-oauth/grok-4.7';
  const QWEN = 'direct/qwen/qwen3.8-max';
  const FLASH = 'direct/qwen/qwen3.8-flash';
  const LADDERED: CatalogView = {
    vendorOf: (m) => (m.startsWith('claude') ? 'anthropic' : m.split('/')[1] ?? m),
    tierOf: (m) => (m === OPUS || m === GROK ? 'ULTRA' : m === FLASH ? 'STANDARD' : 'PREMIUM'),
    priceOf: (m) => (m === FLASH ? { input: 0.1e-6, output: 0.4e-6 } : { input: 3e-6, output: 15e-6 }),
    ladderRankOf,
  };
  const connected = [OPUS, GROK, QWEN, KIMI, K3, SONNET];

  it('code leads with the best coder per cost — Sonnet, Kimi K3, Kimi Code — and Opus only after Qwen Max', () => {
    expect(orderForRole(connected, resolveRoleObjective('code'), LADDERED, undefined, undefined, 'code'))
      .toEqual([SONNET, K3, KIMI, QWEN, OPUS, GROK]);
  });

  it('plan and review lead with the strongest judge', () => {
    for (const role of ['plan', 'review'] as const) {
      expect(orderForRole(connected, resolveRoleObjective(role), LADDERED, undefined, undefined, role)[0]).toBe(OPUS);
    }
  });

  it('verify leads with the cheapest', () => {
    expect(orderForRole([OPUS, SONNET, FLASH], resolveRoleObjective('verify'), LADDERED, undefined, undefined, 'verify')[0]).toBe(FLASH);
  });

  it('the ladder applies only to a quality-first objective: a cost-first laddered role reads tier and price', () => {
    // `code` has a ladder, but an objective < 0 (cost-first) must not be led by its
    // strongest-coder rung — the cheapest leads, exactly as for verify.
    expect(orderForRole([SONNET, OPUS, FLASH], -1, LADDERED, undefined, undefined, 'code')[0]).toBe(FLASH);
    expect(orderForRole([FLASH, SONNET], -1, LADDERED, undefined, undefined, 'plan')).toEqual([FLASH, SONNET]);
  });

  it('an off-ladder model follows every on-ladder one; health still outranks the ladder', () => {
    expect(orderForRole([FLASH, SONNET], resolveRoleObjective('code'), LADDERED, undefined, undefined, 'code')).toEqual([SONNET, FLASH]);
    expect(orderForRole([SONNET, K3], resolveRoleObjective('code'), LADDERED, new Set(['anthropic']), undefined, 'code')[0]).toBe(K3);
  });

  it('rankConnectedForRole threads the role to the ladder', () => {
    expect(rankConnectedForRole(connected, LADDERED, { role: 'code' })[0]).toBe(SONNET);
    expect(rankConnectedForRole(connected, LADDERED, { role: 'plan' })[0]).toBe(OPUS);
    expect(rankConnectedForRole(connected, LADDERED, { role: 'chat' })).toEqual(connected);
  });
});

describe('rankConnectedForRole', () => {
  it('re-ranks by learned evidence only where the role lets the system choose', () => {
    const stats = [
      { model: 'sonnet', n: 20, avgScore: 0.95, avgCostMc: 10 },
      { model: 'opus', n: 20, avgScore: 0.5, avgCostMc: 50 },
    ];
    expect(rankConnectedForRole(['opus', 'sonnet'], VIEW, { role: 'code', stats })[0]).toBe('sonnet');
    expect(rankConnectedForRole(['opus', 'sonnet'], VIEW, { role: 'chat', stats })).toEqual(['opus', 'sonnet']);
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

  it('re-ranks by learned evidence where the role lets the system choose', () => {
    const stats = [
      { model: 'mini', n: 20, avgScore: 0.95, avgCostMc: 10 },
      { model: 'sonnet', n: 20, avgScore: 0.4, avgCostMc: 50 },
    ];
    // Quality-first: no price order, but the evidence leads.
    expect(orderPoolForWorkload(pool, { ...base, role: 'code' }, VIEW, { stats })[0]).toBe('mini');
    // Cost-first: cost orders first, then the evidence re-ranks the eligible models.
    expect(orderPoolForWorkload(pool, { ...base, role: 'explore' }, VIEW, { stats })[0]).toBe('mini');
    // A balanced role keeps the pool's own order whatever the evidence says.
    expect(orderPoolForWorkload(pool, { ...base, role: 'chat' }, VIEW, { stats })).toEqual(pool);
  });

  it('keeps the cost order when the evidence is cold', () => {
    const cold = [{ model: 'sonnet', n: 1, avgScore: 1, avgCostMc: 1 }];
    expect(orderPoolForWorkload(pool, { ...base, role: 'explore' }, VIEW, { stats: cold })).toEqual(['nemo', 'flash', 'mini', 'sonnet']);
  });
});
