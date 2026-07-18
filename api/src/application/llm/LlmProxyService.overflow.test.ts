import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GUARANTEED_BACKSTOP_MODEL,
  PREMIUM_FALLBACK_MODELS,
  isPaidOverflowModel,
  resolveCacheTtl,
  llmProxyForPlan,
  type ProxyEnv,
} from './LlmProxyService';

// ---------------------------------------------------------------------------
// isPaidOverflowModel — classifies a resolved model as funded-overflow spend
// (premium fallback / reliability backstop on Builderforce's own key) vs a
// plan-pool model the tenant's plan actually unlocks. Drives the per-tenant
// daily overflow cap (migration 0130).
// ---------------------------------------------------------------------------

describe('isPaidOverflowModel', () => {
  it('flags every premium-fallback model', () => {
    for (const m of PREMIUM_FALLBACK_MODELS) expect(isPaidOverflowModel(m)).toBe(true);
  });

  it('flags the reliability backstop models (general + coding)', () => {
    expect(isPaidOverflowModel(GUARANTEED_BACKSTOP_MODEL)).toBe(true);
    expect(isPaidOverflowModel('deepseek/deepseek-v4-flash')).toBe(true);
  });

  it('does NOT flag plan-pool models or null/undefined', () => {
    expect(isPaidOverflowModel('anthropic/claude-sonnet-5')).toBe(false);
    expect(isPaidOverflowModel('meta-llama/llama-3.3-70b-instruct:free')).toBe(false);
    expect(isPaidOverflowModel(null)).toBe(false);
    expect(isPaidOverflowModel(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveCacheTtl — reads the per-request `_builderforce.cacheTtl` opt-in.
// ---------------------------------------------------------------------------

describe('resolveCacheTtl', () => {
  it("returns '1h' only for the explicit hint", () => {
    expect(resolveCacheTtl({ _builderforce: { cacheTtl: '1h' } })).toBe('1h');
  });

  it('returns undefined (default 5m) for any other / absent value', () => {
    expect(resolveCacheTtl({})).toBeUndefined();
    expect(resolveCacheTtl({ _builderforce: {} })).toBeUndefined();
    expect(resolveCacheTtl({ _builderforce: { cacheTtl: '2h' } })).toBeUndefined();
    expect(resolveCacheTtl({ _builderforce: 'nope' as unknown as Record<string, unknown> })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// disablePaidOverflow — when the tenant's overflow cap is exhausted the proxy
// must NOT fall through to the funded backstop; an exhausted free pool surfaces
// cascade_exhausted instead of spending more on our keys.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Saturated free pool; the backstop on the Pro key would answer if reached. */
function installSaturatedPoolFetch(): string[] {
  const seen: string[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    const authKey = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '').replace(/^Bearer\s+/, '');
    const model = body.model ?? '';
    seen.push(model);
    if (model === GUARANTEED_BACKSTOP_MODEL && authKey === 'or-pro') {
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429, headers: { 'content-type': 'application/json' } });
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return seen;
}

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

describe('disablePaidOverflow', () => {
  it('default (overflow enabled): saturated free pool resolves via the funded backstop and flags paidOverflow', async () => {
    installSaturatedPoolFetch();
    const proxy = llmProxyForPlan(env, 'free');
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.response.status).toBe(200);
    expect(result.resolvedModel).toBe(GUARANTEED_BACKSTOP_MODEL);
    expect(result.paidOverflow).toBe(true);
  });

  it('overflow disabled: never funds the backstop — surfaces cascade_exhausted instead', async () => {
    const seen = installSaturatedPoolFetch();
    const proxy = llmProxyForPlan(env, 'free', false, { disablePaidOverflow: true });
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.response.status).toBe(429);
    expect(result.outcome).toBe('cascade_exhausted');
    // The funded backstop was never dispatched.
    expect(seen.includes(GUARANTEED_BACKSTOP_MODEL)).toBe(false);
    // No premium-fallback model was attempted either.
    expect(seen.some((m) => PREMIUM_FALLBACK_MODELS.includes(m))).toBe(false);
  });
});
