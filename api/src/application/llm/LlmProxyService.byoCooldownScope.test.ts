import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns, loadCooldowns, recordFailure } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// COOLDOWN SCOPE — the cooldown keyspace is GLOBAL (`cooldown:<vendor>:<model>`),
// which is right for the operator's shared keys and wrong for a tenant's own account.
//
// The production symptom that motivated this: Settings ▸ Integrations showed
// "● ChatGPT/Codex subscription connected" while Test connection returned
//
//     Strict-pin: model 'openai-codex/gpt-5.3-codex' is unavailable (cooldown).
//
// Nothing had been learned about THAT tenant's account — the bench came from the shared
// keyspace, and the strict path (unlike the cascade path, which already exempted BYO via
// its probe backstop) failed closed on it. So the owner saw a synthetic 503 that read as
// "your provider is down", and the real upstream state stayed invisible.
//
// The rule under test, in both directions:
//   READ  — a vendor the tenant serves themselves is never GATED by a global cooldown.
//   WRITE — a failure on the tenant's own credential never WRITES one (it would bench
//           that model for our shared key and for every other tenant).
// Shared vendors must keep their existing behaviour exactly.
// ---------------------------------------------------------------------------

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });
beforeEach(() => { _resetMemoryCooldowns(); });

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

const OWNER_TOKEN = 'sk-ant-oat-test-token';
const PINNED = 'claude-opus-5';

/** Anthropic Messages 200 body (native shape — the vendor translates it). */
function anthropicOk(text: string) {
  return new Response(
    JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const strictRequest = {
  model: PINNED,
  modelStrict: true,
  messages: [{ role: 'user' as const, content: 'Reply OK.' }],
};

describe('strict pin — the tenant’s OWN account is exempt from the shared cooldown', () => {
  it('dispatches a connected-account pin that the GLOBAL keyspace has benched', async () => {
    // Someone else's 401 on the same (vendor, model) — an operator key, another tenant's
    // expired token. It says nothing about this owner's subscription. A 401 also trips
    // VENDOR cooldown on the first strike, so both gates are cooled here.
    await recordFailure(env, 'anthropic', PINNED, 401);

    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ANTHROPIC_ENDPOINT) return anthropicOk('OK');
      throw new Error(`unexpected fetch: ${url}`);
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'free', false, { anthropicOAuthToken: OWNER_TOKEN, disablePaidOverflow: true });
    const result = await proxy.complete(strictRequest);

    expect(result.response.status).toBe(200);
    expect(result.outcome).not.toBe('strict_unavailable');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('still 503s a SHARED-key pin on cooldown — the exemption is BYO-only', async () => {
    await recordFailure(env, 'openrouter', 'openai/gpt-4.1', 401);

    const fetchSpy = vi.fn(async () => { throw new Error('a cooled shared model must not dispatch'); });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    // No connected credential → the shared keyspace speaks for this call, as before.
    const result = await llmProxyForPlan(env, 'pro').complete({
      model: 'openai/gpt-4.1', modelStrict: true, messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.response.status).toBe(503);
    expect(result.outcome).toBe('strict_unavailable');
    const body = await result.response.json() as { details?: { reason?: string } };
    expect(body.details?.reason).toBe('cooldown');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('surfaces the REAL upstream failure instead of a synthetic cooldown 503', async () => {
    // The whole point of the exemption: when the owner's account genuinely IS broken, the
    // operator must see the provider's own 401 — that is what the Integrations page, the
    // auth-alert store and the daily sweep all classify from. A cooldown 503 carries no
    // upstream status at all, which is why a lapsed subscription stayed invisible.
    await recordFailure(env, 'anthropic', PINNED, 401);

    (globalThis as { fetch: typeof fetch }).fetch = (async () => new Response(
      JSON.stringify({ error: { message: 'OAuth token expired' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'free', false, { anthropicOAuthToken: OWNER_TOKEN, disablePaidOverflow: true });
    const result = await proxy.complete(strictRequest);

    expect(result.outcome).not.toBe('strict_unavailable');
    expect(result.failovers?.some((f) => f.code === 401 && f.vendor === 'anthropic')).toBe(true);
  });
});

describe('cooldown writes — an owner’s failure must not bench the shared pool', () => {
  it('records NO global cooldown when the tenant’s own credential fails', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = (async () => new Response(
      JSON.stringify({ error: { message: 'OAuth token expired' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'free', false, { anthropicOAuthToken: OWNER_TOKEN, disablePaidOverflow: true });
    await proxy.complete(strictRequest);

    // One tenant's expired subscription would otherwise cool `anthropic/claude-opus-5`
    // for 30 minutes across the whole platform — and trip the vendor on the first strike.
    expect(await loadCooldowns(env, [{ vendor: 'anthropic', model: PINNED }])).toEqual(new Set());
  });

  it('still records a cooldown when a SHARED key fails', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = (async () => new Response(
      JSON.stringify({ error: { message: 'unauthorized' } }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    await llmProxyForPlan(env, 'pro').complete({
      model: 'openai/gpt-4.1', modelStrict: true, messages: [{ role: 'user', content: 'hi' }],
    });

    expect(await loadCooldowns(env, [{ vendor: 'openrouter', model: 'openai/gpt-4.1' }]))
      .toEqual(new Set(['openrouter/openai/gpt-4.1']));
  });
});
