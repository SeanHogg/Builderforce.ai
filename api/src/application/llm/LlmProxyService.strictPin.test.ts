import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GUARANTEED_BACKSTOP_MODEL,
  llmProxyForPlan,
  resolveStrictPin,
  type ProxyEnv,
} from './LlmProxyService';

// ---------------------------------------------------------------------------
// Strict model pinning (gw:strict-pin) — when a caller sets `strict: true`
// (the public SDK alias) or `modelStrict: true` (the gateway-internal flag),
// the gateway must dispatch ONLY the named model: no cascade, no failover, no
// paid backstop substitution. An unavailable model 503s instead of silently
// swapping. These tests assert the 503-rather-than-substitute contract.
//
// Vendor calls are mocked via global fetch; we branch on the request body's
// `model` so we can prove which models were (and weren't) dispatched.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const env: ProxyEnv = {
  OPENROUTER_API_KEY: 'or-free',
  OPENROUTER_API_KEY_PRO: 'or-pro',
};

describe('resolveStrictPin', () => {
  it('is true for the public `strict` alias, the internal `modelStrict`, or `?strict=true`', () => {
    expect(resolveStrictPin({ model: 'openai/gpt-4.1', strict: true })).toBe(true);
    expect(resolveStrictPin({ model: 'openai/gpt-4.1', modelStrict: true })).toBe(true);
    expect(resolveStrictPin({ model: 'openai/gpt-4.1' }, /* queryStrict */ true)).toBe(true);
  });

  it('is false without a named model (nothing to pin) or without any strict signal', () => {
    expect(resolveStrictPin({ strict: true })).toBe(false);              // no model
    expect(resolveStrictPin({ model: '', strict: true })).toBe(false);   // empty model
    expect(resolveStrictPin({ model: 'openai/gpt-4.1' })).toBe(false);   // no strict flag
  });
});

describe('strict pin — 503 rather than substitute', () => {
  it('503s with model_unavailable (vendor_key_unconfigured) — does NOT swap models or fetch', async () => {
    // A cerebras-prefixed model with no CEREBRAS_API_KEY bound: the strict path's
    // pre-flight vendor-key gate must 503 BEFORE any dispatch, never falling
    // through to the OpenRouter cascade / backstop the way a soft hint would.
    const fetchSpy = vi.fn(async () => {
      throw new Error('strict pin must not dispatch when the vendor key is unbound');
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'pro'); // paid plan so the entitlement gate isn't the thing under test
    const result = await proxy.complete({
      model: 'cerebras/llama-3.3-70b',
      strict: true,
      messages: [{ role: 'user', content: 'eval prompt' }],
    });

    expect(result.response.status).toBe(503);
    expect(result.outcome).toBe('strict_unavailable');
    const body = await result.response.json() as { code?: string; model?: string; details?: { reason?: string } };
    expect(body.code).toBe('model_unavailable');
    expect(body.model).toBe('cerebras/llama-3.3-70b');
    expect(body.details?.reason).toBe('vendor_key_unconfigured');
    // The cascade/backstop never ran — the gateway didn't substitute another model.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.resolvedModel).toBe('cerebras/llama-3.3-70b');
    expect(result.resolvedModel).not.toBe(GUARANTEED_BACKSTOP_MODEL);
  });

  it('dispatches ONLY the pinned model on success — no cascade, no backstop', async () => {
    const PINNED = 'openai/gpt-4.1';
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      const model = (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model ?? '';
      seen.push(model);
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'pro');
    const result = await proxy.complete({
      model: PINNED,
      strict: true,
      messages: [{ role: 'user', content: 'eval prompt' }],
    });

    expect(result.response.status).toBe(200);
    expect(result.resolvedModel).toBe(PINNED);
    // Exactly one model was ever dispatched — the pinned one. No backstop, no
    // cascade fan-out, and crucially `strict`/`modelStrict` were stripped from
    // the vendor body (they're gateway-only flags).
    expect(seen).toEqual([PINNED]);
    const dispatchedBody = JSON.parse(String(fetchSpy.mock.calls[0]![1]?.body ?? '{}')) as Record<string, unknown>;
    expect(dispatchedBody.strict).toBeUndefined();
    expect(dispatchedBody.modelStrict).toBeUndefined();
  });
});
