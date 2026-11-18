import { describe, expect, it } from 'vitest';
import { delegationRole, type ModelRole } from '@builderforce/agent-tools';
import { codingModelsForPlan, pickCloudModel } from './LlmProxyService';
import { orderForRole as orderForRoleIn, resolveRoleObjective, roleUsesLearnedRanking } from '@builderforce/model-router';
import { REGISTRY_CATALOG_VIEW } from './catalogView';
import { rankConnectedForRole } from './modelRoles';

/** The router bound to this Worker's registry — exactly what the gateway ranks with. */
const orderForRole = (models: readonly string[], role: ModelRole, demoted?: ReadonlySet<string>): string[] =>
  orderForRoleIn(models, resolveRoleObjective(role), REGISTRY_CATALOG_VIEW, demoted, undefined, role);
import { parseModelShorthand } from './vendors/openaiCompatibleVendors';
import { tierForModel } from './vendors';
import { vendorFlagship } from './vendors';
/** The CURRENT Anthropic flagships, read from the catalog — never a version literal, so a
 *  model release is a catalog edit and these tests follow it. */
const OPUS_FLAGSHIP = vendorFlagship('anthropic', true)!;
const SONNET = vendorFlagship('anthropic', false)!;

const QWEN_MAX = 'direct/qwen/qwen3.8-max';
const QWEN_FLASH = 'direct/qwen/qwen3.8-flash';
const OPUS = OPUS_FLAGSHIP;
const MINIMAX = 'direct/minimax/MiniMax-M2.7';

describe('resolveRoleObjective', () => {
  it('plan, review and code pull to the strongest models, chat keeps the tenant order, mechanical roles pull down', () => {
    expect(resolveRoleObjective('code')).toBe(1);
    expect(resolveRoleObjective('plan')).toBe(1);
    expect(resolveRoleObjective('review')).toBe(1);
    expect(resolveRoleObjective('chat')).toBe(0);
    expect(resolveRoleObjective('verify')).toBe(-1);
    expect(resolveRoleObjective('explore')).toBe(-1);
    expect(resolveRoleObjective(undefined, 'make')).toBe(0);
  });

  it('an arc stage nudges the role objective and is clamped', () => {
    expect(resolveRoleObjective('chat', 'make')).toBeCloseTo(0.3);
    expect(resolveRoleObjective('code', 'make')).toBe(1);
    expect(resolveRoleObjective('explore', 'idea')).toBe(-1);
  });
});

describe('orderForRole', () => {
  // The tenant ranked MiniMax, then Qwen, then Anthropic.
  const precedence = [MINIMAX, QWEN_MAX, OPUS];

  it('a coding turn leads with the best connected coder per cost — MiniMax M2.x (the rung after M3) and Qwen Max ahead of a pricier Opus', () => {
    expect(orderForRole(precedence, 'code')).toEqual([MINIMAX, QWEN_MAX, OPUS]);
    expect(orderForRole([...precedence, SONNET], 'code')[0]).toBe(SONNET);
  });

  it('a planning or review turn leads with the strongest connected judge', () => {
    expect(orderForRole(precedence, 'plan')[0]).toBe(OPUS);
    expect(orderForRole(precedence, 'review')[0]).toBe(OPUS);
  });

  it('a chat turn keeps the tenant precedence exactly', () => {
    expect(orderForRole(precedence, 'chat')).toEqual(precedence);
  });

  it('a cost-first turn leads with the cheapest connected model', () => {
    const ordered = orderForRole([QWEN_MAX, OPUS, QWEN_FLASH], 'explore');
    expect(ordered[0]).toBe(QWEN_FLASH);
    expect(ordered.at(-1)).toBe(OPUS);
  });

  it('a vendor known to be failing never leads, whatever its tier', () => {
    const ordered = orderForRole(precedence, 'plan', new Set(['anthropic']));
    expect(ordered[0]).not.toBe(OPUS);
    expect(ordered.at(-1)).toBe(OPUS);
  });

  it('never adds or drops a model, and keeps precedence among equal tiers', () => {
    const ordered = orderForRole([MINIMAX, QWEN_FLASH], 'code');
    expect(ordered).toEqual([MINIMAX, QWEN_FLASH]);
  });
});

describe('rankConnectedForRole — evidence where the system chooses, the tenant order where it does not', () => {
  const connected = [QWEN_MAX, OPUS, MINIMAX];
  const proven = (model: string) => ({ model, n: 20, avgScore: 0.95, avgCostMc: 10 });
  const weak = (model: string) => ({ model, n: 20, avgScore: 0.2, avgCostMc: 10 });

  it('only roles the system chooses for take learned evidence', () => {
    expect(roleUsesLearnedRanking('code')).toBe(true);
    expect(roleUsesLearnedRanking('plan')).toBe(true);
    expect(roleUsesLearnedRanking('review')).toBe(true);
    expect(roleUsesLearnedRanking('explore')).toBe(true);
    expect(roleUsesLearnedRanking('chat')).toBe(false);
    expect(roleUsesLearnedRanking(undefined)).toBe(false);
  });

  it('with no evidence a coding call keeps the code-ladder order', () => {
    expect(rankConnectedForRole(connected, { role: 'code' })).toEqual([MINIMAX, QWEN_MAX, OPUS]);
    expect(rankConnectedForRole([OPUS, SONNET], { role: 'code' })).toEqual([SONNET, OPUS]);
  });

  it('a coding call leads with the model that has actually delivered best as a coder', () => {
    // Every connected coder measured: an UNTRIED model on a stronger rung would otherwise
    // keep the lead (`liftUntriedStronger`), and MiniMax M2.x now sits on the code ladder.
    expect(rankConnectedForRole(connected, { role: 'code', stats: [proven(OPUS), weak(QWEN_MAX), weak(MINIMAX)] })[0]).toBe(OPUS);
  });

  it('an untried Opus does not unseat a measured Sonnet on a coding call', () => {
    expect(rankConnectedForRole([OPUS, SONNET], { role: 'code', stats: [proven(SONNET)] })[0]).toBe(SONNET);
  });

  it('a chat call keeps the tenant order whatever the evidence says', () => {
    expect(rankConnectedForRole(connected, { role: 'chat', stats: [proven(MINIMAX), weak(QWEN_MAX)] })).toEqual(connected);
  });

  it('evidence cannot lift a vendor that is failing right now back to the lead', () => {
    const ordered = rankConnectedForRole(connected, { role: 'code', stats: [proven(OPUS)], demotedVendors: new Set(['anthropic']) });
    expect(ordered.at(-1)).toBe(OPUS);
  });
});

describe('pickCloudModel — role over precedence', () => {
  const byoVendors = new Set(['minimax', 'qwen', 'anthropic']);
  const byoVendorPriority = ['minimax', 'qwen', 'anthropic'];

  it('a code turn seeds the best connected coder per cost (Sonnet), not the precedence-first account', () => {
    expect(pickCloudModel(undefined, 'free', false, { byoVendors, byoVendorPriority, role: 'code' }).model).toBe(SONNET);
  });

  it('a review turn seeds the strongest connected judge (Opus)', () => {
    expect(pickCloudModel(undefined, 'free', false, { byoVendors, byoVendorPriority, role: 'review' }).model).toBe(OPUS);
  });

  it('an explore delegation keeps off the strongest (priciest) model', () => {
    expect(pickCloudModel(undefined, 'free', false, { byoVendors, byoVendorPriority, role: 'explore' }).model).not.toBe(OPUS);
  });

  it('learned history cannot lift a known-failing vendor back to the lead', () => {
    const pick = pickCloudModel(undefined, 'free', false, {
      byoVendors, byoVendorPriority, role: 'code',
      byoAlertedVendors: ['anthropic'],
      actionStats: [{ model: OPUS, n: 40, avgScore: 0.95, avgCostMc: 10 }],
    });
    expect(pick.model).not.toBe(OPUS);
  });

  it('a priced cost-first role seeds the cheapest plan coder; a code role keeps the curated lead', () => {
    const pool = codingModelsForPlan('pro');
    expect(pool.length).toBeGreaterThan(1);
    const cheapest = pool[pool.length - 1]!;
    const prices = {
      priceOf: (m: string) => (m === cheapest ? { input: 1e-9, output: 1e-9 } : { input: 1e-5, output: 4e-5 }),
    };
    expect(pickCloudModel(undefined, 'pro', false, { role: 'explore', prices }).model).toBe(cheapest);
    expect(pickCloudModel(undefined, 'pro', false, { role: 'code', prices }).model).toBe(pool[0]);
  });
});

describe('delegationRole', () => {
  it('honours a named role, else code', () => {
    expect(delegationRole('verify')).toBe('verify');
    expect(delegationRole(undefined)).toBe('code');
    expect(delegationRole('nonsense')).toBe('code');
  });
});

describe('parseModelShorthand', () => {
  it('reads an explicit tier prefix and defaults a bare id to STANDARD', () => {
    expect(parseModelShorthand('PREMIUM:qwen3.8-max')).toEqual({ id: 'qwen3.8-max', tier: 'PREMIUM' });
    expect(parseModelShorthand('qwen3.8-flash')).toEqual({ id: 'qwen3.8-flash', tier: 'STANDARD' });
  });

  it('a direct-routed id reads the tier its vendor declared, not the vendor default', () => {
    expect(tierForModel(QWEN_MAX)).toBe('PREMIUM');
    expect(tierForModel(QWEN_FLASH)).toBe('STANDARD');
    expect(tierForModel('direct/xai/grok-4.5')).toBe('ULTRA');
    expect(tierForModel(OPUS)).toBe('ULTRA');
  });
});
