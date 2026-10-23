/**
 * D3 routing exploration at the seed: `composeCompletionSeed` hands the learned
 * re-rankers (plan pool AND connected accounts) an exploration source only when the
 * `d3_routing_exploration` lever is on for the tenant and the call did not name its
 * model — never under a strict pin, an honoured caller hint, or the BYO boundary.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spies = vi.hoisted(() => ({ pool: vi.fn(), connected: vi.fn() }));

vi.mock('@builderforce/model-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@builderforce/model-router')>();
  return {
    ...actual,
    orderPoolForWorkload: (...args: Parameters<typeof actual.orderPoolForWorkload>) => {
      spies.pool(args[3]);
      return actual.orderPoolForWorkload(...args);
    },
  };
});
vi.mock('./modelRoles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./modelRoles')>();
  return {
    ...actual,
    rankConnectedForRole: (...args: Parameters<typeof actual.rankConnectedForRole>) => {
      spies.connected(args[1]);
      return actual.rankConnectedForRole(...args);
    },
  };
});

import { composeCompletionSeed } from './proxySeed';
import { resolveProxyConfig } from './proxyConfig';
import { ProxyFunding } from './proxyFunding';
import type { ChatCompletionRequest, LlmProxyOptions, ProxyEnv } from './proxyTypes';

const ON: ProxyEnv = { OPENROUTER_API_KEY: 'k', COST_LEVER_D3_ROUTING_EXPLORATION: 'on' } as ProxyEnv;
const OFF: ProxyEnv = { OPENROUTER_API_KEY: 'k', COST_LEVER_D3_ROUTING_EXPLORATION: 'off' } as ProxyEnv;
const roleStats = [{ model: 'm', n: 20, avgScore: 0.8, mergeRate: 0.5, avgCostMc: 1 }];
const body = { role: 'code', messages: [{ role: 'user', content: 'go' }] } as unknown as ChatCompletionRequest;

function rt(env: ProxyEnv, opts: LlmProxyOptions = {}) {
  const cfg = resolveProxyConfig(env, { tenantId: 7, ...opts });
  return { cfg, funding: new ProxyFunding(cfg) };
}

const explored = (spy: typeof spies.pool) => spy.mock.calls.some(([o]) => o?.explore && typeof o.explore.rng === 'function');

beforeEach(() => { spies.pool.mockClear(); spies.connected.mockClear(); });

describe('composeCompletionSeed — D3 exploration', () => {
  it('passes an exploration source to both re-rankers when the lever is on', async () => {
    await composeCompletionSeed(rt(ON), body, undefined, { roleStats });
    expect(explored(spies.pool)).toBe(true);
    expect(explored(spies.connected)).toBe(true);
  });

  it('is deterministic with the lever off', async () => {
    await composeCompletionSeed(rt(OFF), body, undefined, { roleStats });
    expect(explored(spies.pool)).toBe(false);
    expect(explored(spies.connected)).toBe(false);
  });

  it('never explores a strict pin', async () => {
    const strict = { ...body, model: 'openai/gpt-test', modelStrict: true } as ChatCompletionRequest;
    await composeCompletionSeed(rt(ON), strict, 'openai/gpt-test', { roleStats });
    expect(explored(spies.pool)).toBe(false);
    expect(explored(spies.connected)).toBe(false);
  });

  it('never explores when an honoured caller hint leads', async () => {
    // Nothing connected ⇒ a caller model preempts the (empty) BYO seed and leads.
    await composeCompletionSeed(rt(ON), body, 'openai/gpt-4.1', { roleStats });
    expect(explored(spies.pool)).toBe(false);
  });

  it('never explores inside the BYO boundary', async () => {
    await composeCompletionSeed(rt(ON, { tenantVendorKeys: { ollama: 'ollama-key' } }), body, undefined, { roleStats });
    expect(explored(spies.pool)).toBe(false);
    expect(explored(spies.connected)).toBe(false);
  });
});
