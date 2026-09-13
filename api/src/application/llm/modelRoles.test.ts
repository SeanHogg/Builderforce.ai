import { describe, expect, it } from 'vitest';
import { delegationRole } from '@builderforce/agent-tools';
import { pickCloudModel } from './LlmProxyService';
import { orderForRole } from './modelPool';
import { rankConnectedForRole, resolveRoleObjective, roleUsesLearnedRanking } from './modelRoles';
import { parseModelShorthand } from './vendors/openaiCompatibleVendors';
import { tierForModel } from './vendors';

const QWEN_MAX = 'direct/qwen/qwen3.8-max';
const QWEN_FLASH = 'direct/qwen/qwen3.8-flash';
const OPUS = 'claude-opus-5';
const MINIMAX = 'direct/minimax/MiniMax-M1';

describe('resolveRoleObjective', () => {
  it('code pulls to the strongest model, analysis keeps the tenant order, cheap roles pull down', () => {
    expect(resolveRoleObjective('code')).toBe(1);
    expect(resolveRoleObjective('plan')).toBe(0);
    expect(resolveRoleObjective('chat')).toBe(0);
    expect(resolveRoleObjective('explore')).toBe(-1);
    expect(resolveRoleObjective(undefined, 'make')).toBe(0);
  });

  it('an arc stage nudges the role objective and is clamped', () => {
    expect(resolveRoleObjective('plan', 'make')).toBeCloseTo(0.3);
    expect(resolveRoleObjective('code', 'make')).toBe(1);
    expect(resolveRoleObjective('explore', 'idea')).toBe(-1);
  });
});

describe('orderForRole', () => {
  // The tenant ranked MiniMax, then Qwen, then Anthropic.
  const precedence = [MINIMAX, QWEN_MAX, OPUS];

  it('a coding turn leads with the strongest CONNECTED model across vendors', () => {
    expect(orderForRole(precedence, resolveRoleObjective('code'))[0]).toBe(OPUS);
  });

  it('an analysis turn keeps the tenant precedence exactly', () => {
    expect(orderForRole(precedence, resolveRoleObjective('plan'))).toEqual(precedence);
  });

  it('a cost-first turn leads with the cheapest connected model', () => {
    const ordered = orderForRole([QWEN_MAX, OPUS, QWEN_FLASH], resolveRoleObjective('explore'));
    expect(ordered[0]).toBe(QWEN_FLASH);
    expect(ordered.at(-1)).toBe(OPUS);
  });

  it('a vendor known to be failing never leads, whatever its tier', () => {
    const ordered = orderForRole(precedence, resolveRoleObjective('code'), new Set(['anthropic']));
    expect(ordered[0]).not.toBe(OPUS);
    expect(ordered.at(-1)).toBe(OPUS);
  });

  it('never adds or drops a model, and keeps precedence among equal tiers', () => {
    const ordered = orderForRole([MINIMAX, QWEN_FLASH], resolveRoleObjective('code'));
    expect(ordered).toEqual([MINIMAX, QWEN_FLASH]);
  });
});

describe('rankConnectedForRole — evidence where the system chooses, the tenant order where it does not', () => {
  const connected = [QWEN_MAX, OPUS, MINIMAX];
  const proven = (model: string) => ({ model, n: 20, avgScore: 0.95, avgCostMc: 10 });
  const weak = (model: string) => ({ model, n: 20, avgScore: 0.2, avgCostMc: 10 });

  it('only roles the system chooses for take learned evidence', () => {
    expect(roleUsesLearnedRanking('code')).toBe(true);
    expect(roleUsesLearnedRanking('explore')).toBe(true);
    expect(roleUsesLearnedRanking('plan')).toBe(false);
    expect(roleUsesLearnedRanking('chat')).toBe(false);
    expect(roleUsesLearnedRanking(undefined)).toBe(false);
  });

  it('with no evidence a coding call keeps the tier order', () => {
    expect(rankConnectedForRole(connected, { role: 'code' })[0]).toBe(OPUS);
  });

  it('a coding call leads with the model that has actually delivered best as a coder', () => {
    expect(rankConnectedForRole(connected, { role: 'code', stats: [proven(QWEN_MAX), weak(OPUS)] })[0]).toBe(QWEN_MAX);
  });

  it('an analysis call keeps the tenant order whatever the evidence says', () => {
    expect(rankConnectedForRole(connected, { role: 'plan', stats: [proven(MINIMAX), weak(QWEN_MAX)] })).toEqual(connected);
  });

  it('evidence cannot lift a vendor that is failing right now back to the lead', () => {
    const ordered = rankConnectedForRole(connected, { role: 'code', stats: [proven(OPUS)], demotedVendors: new Set(['anthropic']) });
    expect(ordered.at(-1)).toBe(OPUS);
  });
});

describe('pickCloudModel — role over precedence', () => {
  const byoVendors = new Set(['minimax', 'qwen', 'anthropic']);
  const byoVendorPriority = ['minimax', 'qwen', 'anthropic'];

  it('a code turn seeds the strongest connected coder, not the precedence-first account', () => {
    expect(pickCloudModel(undefined, 'free', false, { byoVendors, byoVendorPriority, role: 'code' }).model).toBe(OPUS);
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
});

describe('delegationRole', () => {
  it('honours a named role, else follows read_only', () => {
    expect(delegationRole('verify', true)).toBe('verify');
    expect(delegationRole(undefined, true)).toBe('explore');
    expect(delegationRole(undefined, false)).toBe('code');
    expect(delegationRole('nonsense', false)).toBe('code');
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
