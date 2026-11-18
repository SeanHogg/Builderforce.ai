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
import { byoRoleOrderFor, parseByoOrderRole } from './byoRoleOrder';
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
async function gatewayOrder(creds: TenantLlmCredentials, role: ModelRole): Promise<string[]> {
  const cfg = resolveProxyConfig(env, {
    tenantVendorKeys: creds.vendorKeys,
    codingOnly: true,
    ...byoRoutingOptions(creds),
  });
  const body = {
    messages: [{ role: 'user', content: 'do the work' }],
    tools: [{ type: 'function', function: { name: 'edit_file', description: 'edit', parameters: {} } }],
    role,
  } as ChatCompletionRequest;
  const { seedHead } = await composeCompletionSeed({ cfg, funding: new ProxyFunding(cfg) }, body, undefined);
  return [...seedHead];
}

const refs = (creds: TenantLlmCredentials, role: ModelRole, demoted = new Set<string>()) =>
  byoRoleOrderFor(creds, role, demoted).models.map((m) => m.ref);

beforeEach(() => { _resetMemoryCooldowns(); });

describe('BYO seeds are ordered by role', () => {
  it('code: Sonnet leads, then Kimi K3; Opus is still offered, behind them', () => {
    const order = refs(credentials(), 'code');
    expect(order[0]).toBe(SONNET);
    expect(order[1]).toBe(K3);
    expect(order).toContain(OPUS);
    expect(order.indexOf(OPUS)).toBeGreaterThan(order.indexOf(K3));
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
    const order = byoRoleOrderFor(credentials(['anthropic']), 'code', new Set(['anthropic']));
    expect(order.models[0]!.ref).toBe(K3);
    const sonnet = order.models.find((m) => m.ref === SONNET)!;
    expect(sonnet).toMatchObject({ vendor: 'anthropic', provider: 'anthropic', healthy: false });
    expect(order.models[0]).toMatchObject({ vendor: 'kimi-code', provider: 'kimi', healthy: true });
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

  it('an absent or unknown role reads as code', () => {
    expect(parseByoOrderRole(undefined)).toBe('code');
    expect(parseByoOrderRole('nonsense')).toBe('code');
    expect(parseByoOrderRole('review')).toBe('review');
  });
});
