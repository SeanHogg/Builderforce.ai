/**
 * Routing picks models BY ROLE (product rule, 2026-11-17), end to end over a tenant's
 * connected accounts:
 *   • code → the best coder per cost leads (Sonnet before Opus);
 *   • plan / review → the strongest judge leads (Opus);
 *   • verify → the cheapest;
 *   • chat → the tenant's own order.
 * And `GET /llm/byo-order` (`byoRoleOrderFor`) hands the editor EXACTLY the order the
 * gateway seeds a `byo_pool` turn with — same function, so they cannot drift.
 *
 * The tenant: Anthropic, Kimi Code (subscription, plan includes K3 — selected in provider
 * model choice, the only entitlement signal the server has), xAI, Qwen, MiniMax and
 * Moonshot connected, nothing ranked.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModelRole } from '@builderforce/agent-tools';
import { byoRoleOrderCacheKey, byoRoleOrderFor, parseByoOrderQuery } from './byoRoleOrder';
import { composeCompletionSeed } from './proxySeed';
import { resolveProxyConfig } from './proxyConfig';
import { ProxyFunding } from './proxyFunding';
import { byoRoutingOptions } from './tenantProxy';
import type { TenantLlmCredentials } from './tenantProviderKeyService';
import { vendorFlagship } from './vendors';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';
import type { ChatCompletionRequest, ProxyEnv } from './proxyTypes';

const OPUS = vendorFlagship('anthropic', true)!;
const SONNET = vendorFlagship('anthropic', false)!;
const K3 = 'direct/kimi-code/k3';
const KIMI_CODER = 'direct/kimi-code/kimi-for-coding';
const MOONSHOT_K3 = 'direct/moonshot/kimi-k3';

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

/** What `resolveTenantLlmCredentials` returns for this tenant (unranked → code-ladder order). */
function credentials(alertedVendors: string[] = []): TenantLlmCredentials {
  const providers = ['anthropic', 'moonshot', 'kimi', 'minimax', 'qwen', 'xai'] as const;
  const vendorOf: Record<(typeof providers)[number], string> = {
    anthropic: 'anthropic', moonshot: 'moonshot', kimi: 'kimi-code', minimax: 'minimax', qwen: 'qwen', xai: 'xai',
  };
  return {
    anthropicOAuthToken: null,
    openaiCodexAuth: null,
    xaiOAuthToken: null,
    // A Kimi Code subscription token lands as the `kimi` vendor key.
    vendorKeys: { anthropic: 'sk-ant', moonshot: 'sk-ms', kimi: 'kimi-oauth-token', minimax: 'sk-mm', qwen: 'sk-qw', xai: 'xai-key' },
    configuredProviders: [...providers],
    unresolvedReasons: {},
    vendorPriority: providers.map((p) => vendorOf[p]),
    alertedVendors,
    providerPriorities: providers.map((p) => ({ vendor: vendorOf[p], priority: null })),
    openRouterConnections: [],
    // The plan includes K3, so the tenant put it first in Kimi Code's model choice.
    byoSelectedModels: { 'kimi-code': [K3, KIMI_CODER] },
  };
}

/** The gateway's own seed head for a `byo_pool` turn of this role (no caller model). */
async function gatewayOrder(creds: TenantLlmCredentials, role: ModelRole | undefined): Promise<string[]> {
  const cfg = resolveProxyConfig(env, {
    tenantVendorKeys: creds.vendorKeys,
    codingOnly: true,
    ...byoRoutingOptions(creds),
  });
  const body = {
    messages: [{ role: 'user', content: 'do the work' }],
    tools: [{ type: 'function', function: { name: 'edit_file', description: 'edit', parameters: {} } }],
    ...(role ? { role } : {}),
  } as ChatCompletionRequest;
  const { seedHead } = await composeCompletionSeed({ cfg, funding: new ProxyFunding(cfg) }, body, undefined);
  return [...seedHead];
}

const refs = (creds: TenantLlmCredentials, role: ModelRole | undefined, demoted = new Set<string>()) =>
  byoRoleOrderFor(creds, { ...(role ? { role } : {}), demotedVendors: demoted }).models.map((m) => m.ref);

/** The fixture with Kimi Code ranked ahead of Moonshot in the tenant's precedence. */
function kimiCodeBeforeMoonshot(alertedVendors: string[] = []): TenantLlmCredentials {
  const creds = credentials(alertedVendors);
  const swap = (order: readonly string[]) => {
    const out = [...order];
    const m = out.indexOf('moonshot');
    const k = out.indexOf('kimi-code');
    [out[m], out[k]] = [out[k]!, out[m]!];
    return out;
  };
  return {
    ...creds,
    vendorPriority: swap(creds.vendorPriority),
    providerPriorities: swap(creds.providerPriorities!.map((p) => p.vendor)).map((vendor) => ({ vendor, priority: null })),
  };
}

beforeEach(() => { _resetMemoryCooldowns(); });

describe('BYO seeds are ordered by role', () => {
  it('code: Sonnet leads, then Kimi K3 — the tenant precedence (Moonshot before Kimi Code) breaks the K3 tie; Opus is still offered, behind them', () => {
    const order = refs(credentials(), 'code');
    expect(order[0]).toBe(SONNET);
    // Moonshot's and Kimi Code's K3 hold the same code rung; the stable sort keeps the
    // tenant's precedence, which lists Moonshot first.
    expect(order[1]).toBe(MOONSHOT_K3);
    expect(order[2]).toBe(K3);
    expect(order).toContain(OPUS);
    expect(order.indexOf(OPUS)).toBeGreaterThan(order.indexOf(K3));
    expect(order.indexOf(OPUS)).toBeGreaterThan(order.indexOf(KIMI_CODER));
  });

  it('…and with Kimi Code ranked ahead of Moonshot, Kimi Code’s K3 takes that place', () => {
    const order = refs(kimiCodeBeforeMoonshot(), 'code');
    expect(order[0]).toBe(SONNET);
    expect(order[1]).toBe(K3);
    expect(order[2]).toBe(MOONSHOT_K3);
  });

  it('Moonshot K3 tied ahead: with Anthropic down, Moonshot leads — Kimi Code is NOT first', () => {
    // The client puts its host-called Kimi Code account before the gateway only when it
    // heads the healthy order; here it must not.
    const order = byoRoleOrderFor(credentials(['anthropic']), { role: 'code', demotedVendors: new Set(['anthropic']) });
    expect(order.models[0]).toEqual({ ref: MOONSHOT_K3, vendor: 'moonshot', provider: 'moonshot', healthy: true, callableByGateway: true });
    expect(order.models[0]!.vendor).not.toBe('kimi-code');
    expect(order.models[1]!.ref).toBe(K3);
  });

  it('plan and review: Opus leads', () => {
    expect(refs(credentials(), 'plan')[0]).toBe(OPUS);
    expect(refs(credentials(), 'review')[0]).toBe(OPUS);
  });

  it('Kimi Code contributes K3 when the account is entitled (selected), ahead of its default coder', () => {
    const order = refs(credentials(), 'review');
    expect(order).toContain(K3);
    expect(order.indexOf(K3)).toBeLessThan(order.indexOf(KIMI_CODER));
  });

  it('chat keeps the tenant order (code-ladder default for un-ranked providers)', () => {
    expect(refs(credentials(), 'chat')[0]).toBe(OPUS);
  });

  it('a demoted vendor never leads and is reported unhealthy', () => {
    const order = byoRoleOrderFor(kimiCodeBeforeMoonshot(['anthropic']), { role: 'code', demotedVendors: new Set(['anthropic']) });
    expect(order.models[0]!.ref).toBe(K3);
    expect(order.models.at(-1)!.vendor).toBe('anthropic');
    const sonnet = order.models.find((m) => m.ref === SONNET)!;
    expect(sonnet).toMatchObject({ vendor: 'anthropic', provider: 'anthropic', healthy: false });
    expect(order.models.find((m) => m.ref === K3)).toMatchObject({ vendor: 'kimi-code', provider: 'kimi', healthy: true });
  });
});

describe('the server does not vouch for an account it cannot observe', () => {
  it('Kimi Code with a stale alert and NO online host: healthy, keeps its place, callableByGateway false', () => {
    // The gateway never dispatches Kimi Code without a host and the editor's own calls never
    // reach the server, so the alert can never clear — it must not demote the account.
    const order = byoRoleOrderFor(kimiCodeBeforeMoonshot(['kimi-code']), { role: 'code', demotedVendors: new Set(['kimi-code']) });
    expect(order.models.find((m) => m.ref === K3)).toEqual({
      ref: K3, vendor: 'kimi-code', provider: 'kimi', healthy: true, callableByGateway: false,
    });
    expect(order.models.map((m) => m.ref)).toEqual(refs(kimiCodeBeforeMoonshot(), 'code'));
    expect(order.models[1]!.ref).toBe(K3);
    expect(order.models.filter((m) => m.vendor !== 'kimi-code').every((m) => m.callableByGateway)).toBe(true);
  });

  it('…with an online host the gateway observes it: the alert demotes it and it is callable', () => {
    const order = byoRoleOrderFor(kimiCodeBeforeMoonshot(['kimi-code']), {
      role: 'code', demotedVendors: new Set(['kimi-code']), localEgress: true,
    });
    expect(order.models.find((m) => m.ref === K3)).toMatchObject({ healthy: false, callableByGateway: true });
    expect(order.models.at(-1)!.vendor).toBe('kimi-code');
  });

  it('every other vendor is callable by the gateway and keeps its server-side health', () => {
    const order = byoRoleOrderFor(credentials(['anthropic']), { role: 'code', demotedVendors: new Set(['anthropic']) });
    expect(order.models.find((m) => m.ref === SONNET)).toMatchObject({ healthy: false, callableByGateway: true });
  });
});

describe('OpenRouter connections stay in the order', () => {
  /** Kimi Code and an OpenRouter connection, the connection ranked #1 and Kimi Code #2. */
  function connectionFirst(model: string): TenantLlmCredentials {
    return {
      anthropicOAuthToken: null,
      openaiCodexAuth: null,
      xaiOAuthToken: null,
      vendorKeys: { kimi: 'kimi-oauth-token' },
      configuredProviders: ['kimi'],
      unresolvedReasons: {},
      vendorPriority: ['kimi-code'],
      alertedVendors: [],
      providerPriorities: [{ vendor: 'kimi-code', priority: 1 }],
      openRouterConnections: [{ id: 7, label: 'Frontier', models: [model], hasKey: true, priority: 0 }],
      byoSelectedModels: { 'kimi-code': [K3, KIMI_CODER] },
    };
  }

  it('code: the #1 OpenRouter connection heads the list (provider null), not Kimi Code', () => {
    const order = byoRoleOrderFor(connectionFirst('anthropic/claude-sonnet-4.5'), { role: 'code', demotedVendors: new Set() });
    expect(order.models[0]).toEqual({ ref: 'openrouter/anthropic/claude-sonnet-4.5', vendor: 'openrouter', provider: null, healthy: true, callableByGateway: true });
    expect(order.models.map((m) => m.ref)).toEqual(['openrouter/anthropic/claude-sonnet-4.5', K3, KIMI_CODER]);
  });

  it('chat keeps the tenant’s ranking: an off-ladder #1 connection still leads', () => {
    const order = byoRoleOrderFor(connectionFirst('qwen/qwen3-coder'), { role: 'chat', demotedVendors: new Set() });
    expect(order.models[0]!.ref).toBe('openrouter/qwen/qwen3-coder');
    expect(order.models[0]!.provider).toBeNull();
    expect(order.models[1]!.vendor).toBe('kimi-code');
  });

  it('…the same order the gateway seeds with', async () => {
    const creds = connectionFirst('anthropic/claude-sonnet-4.5');
    expect(refs(creds, 'code')).toEqual(await gatewayOrder(creds, 'code'));
  });
});

describe('GET /llm/byo-order is the gateway order', () => {
  it.each(['code', 'plan', 'review', 'verify', 'chat', 'explore'] as const)('%s: same models, same order', async (role) => {
    const creds = credentials();
    expect(refs(creds, role)).toEqual(await gatewayOrder(creds, role));
  });

  it('…with an alerted account demoted the same way', async () => {
    const creds = credentials(['anthropic']);
    expect(refs(creds, 'code', new Set(['anthropic']))).toEqual(await gatewayOrder(creds, 'code'));
  });

  it('an absent or unknown role stays absent — never read as code', () => {
    expect(parseByoOrderQuery({})).toEqual({ agentic: true });
    expect(parseByoOrderQuery({ role: 'nonsense' })).toEqual({ agentic: true });
    expect(parseByoOrderQuery({ role: 'review' }).role).toBe('review');
  });

  it('no role: the same models, same order as the gateway seeds a role-less body with', async () => {
    const creds = credentials();
    expect(refs(creds, undefined)).toEqual(await gatewayOrder(creds, undefined));
    // …the tenant's precedence (Opus heads the un-ranked code-ladder default), not the
    // coding ladder a `code` call reads (Sonnet).
    expect(refs(creds, undefined)[0]).toBe(OPUS);
    expect(refs(creds, 'code')[0]).toBe(SONNET);
    expect(byoRoleOrderFor(creds, { demotedVendors: new Set() }).role).toBeNull();
  });

  it('arcStage is validated; agentic defaults to 1 and only `0` turns it off', () => {
    expect(parseByoOrderQuery({ role: 'code', arcStage: 'make' })).toEqual({ role: 'code', arcStage: 'make', agentic: true });
    expect(parseByoOrderQuery({ role: 'code', arcStage: 'bogus' })).toEqual({ role: 'code', agentic: true });
    expect(parseByoOrderQuery({ agentic: '0' }).agentic).toBe(false);
    expect(parseByoOrderQuery({ agentic: '1' }).agentic).toBe(true);
  });

  it('the cache key carries role, project, arc stage and agentic', () => {
    const keys = new Set([
      byoRoleOrderCacheKey(1, { role: 'code', agentic: true }, 'v'),
      byoRoleOrderCacheKey(1, { role: 'review', agentic: true }, 'v'),
      byoRoleOrderCacheKey(1, { role: 'code', projectId: 9, agentic: true }, 'v'),
      byoRoleOrderCacheKey(1, { role: 'code', arcStage: 'make', agentic: true }, 'v'),
      byoRoleOrderCacheKey(1, { role: 'code', agentic: false }, 'v'),
      byoRoleOrderCacheKey(1, { role: 'code', agentic: true }, 'w'),
      byoRoleOrderCacheKey(1, { agentic: true }, 'v'),
    ]);
    expect(keys.size).toBe(7);
    expect(byoRoleOrderCacheKey(1, { agentic: true }, 'v')).toContain(':r-:');
  });

  it('a non-agentic turn and an arc stage reach the order the way they reach the gateway', async () => {
    const creds = credentials();
    const order = byoRoleOrderFor(creds, { role: 'code', arcStage: 'idea', agentic: false, demotedVendors: new Set() });
    const cfg = resolveProxyConfig(env, { tenantVendorKeys: creds.vendorKeys, codingOnly: false, ...byoRoutingOptions(creds) });
    const body = { messages: [{ role: 'user', content: 'sketch it' }], role: 'code', arcStage: 'idea' } as ChatCompletionRequest;
    const { seedHead } = await composeCompletionSeed({ cfg, funding: new ProxyFunding(cfg) }, body, undefined);
    expect(order.models.map((m) => m.ref)).toEqual([...seedHead]);
  });
});
