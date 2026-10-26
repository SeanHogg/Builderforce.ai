import { beforeEach, describe, expect, it } from 'vitest';
import { buildCandidateChain, composeCompletionSeed } from './proxySeed';
import { resolveProxyConfig } from './proxyConfig';
import { ProxyFunding } from './proxyFunding';
import { vendorForModel, type VendorId } from './vendors';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';
import type { ChatCompletionRequest, LlmProxyOptions, ProxyEnv } from './proxyTypes';

// ---------------------------------------------------------------------------
// END TO END, gateway half: the brain asks for the `code` role once analysis is over
// (`handOffExecution.e2e.test.ts` in brain-embedded proves that end). This file proves
// what the gateway does with it — through the real seed composition and candidate chain
// — for the tenant of VS Code chats #6 and #5739: MiniMax, xAI and Moonshot (Kimi)
// connected, every turn served by MiniMax Flash. A CODE turn must lead the tenant's
// connected accounts with the strongest coder (Grok ULTRA, Kimi PREMIUM) ahead of
// MiniMax Flash (STANDARD), whatever order the tenant ranked them in; a PLAN turn keeps
// the tenant's own order.
// ---------------------------------------------------------------------------

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };
const CONNECTED: readonly VendorId[] = ['minimax', 'xai', 'moonshot'];
const none = () => [new Set<string>(), new Set<VendorId>()] as const;

beforeEach(() => { _resetMemoryCooldowns(); });

function runtime(opts: LlmProxyOptions) {
  const cfg = resolveProxyConfig(env, {
    disablePaidOverflow: true,
    allowGatewayAuto: true,
    tenantVendorKeys: { minimax: 'mm-key', xai: 'xai-key', moonshot: 'ms-key' } as never,
    ...opts,
  });
  return { cfg, funding: new ProxyFunding(cfg) };
}

const turn = (role: string): ChatCompletionRequest => ({
  messages: [{ role: 'user', content: 'remove the title from the top of the VSIX' }],
  tools: [{ type: 'function', function: { name: 'edit_file', description: 'edit', parameters: {} } }],
  role,
} as ChatCompletionRequest);

/** The tenant's own connected accounts, in the order the chain will try them. */
async function connectedOrder(opts: LlmProxyOptions, role: string): Promise<string[]> {
  const rt = runtime(opts);
  const { seed, seedHead } = await composeCompletionSeed(rt, turn(role), undefined);
  const chain = buildCandidateChain(rt, seed, ...none(), undefined, seedHead);
  return chain.filter((m) => CONNECTED.includes(vendorForModel(m) as VendorId));
}

const isMinimax = (m: string) => vendorForModel(m) === 'minimax';

describe('a CODE turn leads with the strongest connected coder (chats #6, #5739)', () => {
  it('puts Grok or Kimi ahead of MiniMax Flash', async () => {
    const order = await connectedOrder({}, 'code');
    expect(order.length, `connected candidates: ${order.join(', ')}`).toBeGreaterThan(1);
    expect(isMinimax(order[0]!), `connected order for a code turn: ${order.join(' > ')}`).toBe(false);
  });

  it('does so on the free-first funding order too', async () => {
    const order = await connectedOrder({ freeFirst: true }, 'code');
    expect(isMinimax(order[0]!), `connected order for a free-first code turn: ${order.join(' > ')}`).toBe(false);
  });

  it('does so even when the tenant ranked MiniMax first — the code role orders by strength', async () => {
    const ranked = { byoProviderPriorities: [{ vendor: 'minimax', priority: 1 }, { vendor: 'xai', priority: 2 }, { vendor: 'moonshot', priority: 3 }] };
    const code = await connectedOrder(ranked, 'code');
    expect(isMinimax(code[0]!), `connected order for a code turn: ${code.join(' > ')}`).toBe(false);
    // …while analysis keeps the tenant's own order.
    const plan = await connectedOrder(ranked, 'plan');
    expect(isMinimax(plan[0]!), `connected order for a plan turn: ${plan.join(' > ')}`).toBe(true);
  });
});
