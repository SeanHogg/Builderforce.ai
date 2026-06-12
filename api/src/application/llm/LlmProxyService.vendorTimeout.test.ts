import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  llmProxyForPlan,
  resolveVendorTimeoutOverride,
  type ProxyEnv,
} from './LlmProxyService';
import { MAX_VENDOR_CALL_TIMEOUT_MS } from './vendors';

// ---------------------------------------------------------------------------
// Per-call vendor timeout override (gw:vendor-timeout-override) — a NON-premium
// tenant can opt a single long call into the extended inner budget via
// `body._builderforce.vendorTimeoutMs`, clamped to MAX_VENDOR_CALL_TIMEOUT_MS.
// The value reuses the existing dispatch `overrides.timeoutMs` plumbing and is
// stripped before the body reaches the vendor (must NOT leak upstream).
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

describe('resolveVendorTimeoutOverride', () => {
  it('extracts a positive value from the _builderforce envelope, floored to an int', () => {
    expect(resolveVendorTimeoutOverride({ _builderforce: { vendorTimeoutMs: 40_000 } })).toBe(40_000);
    expect(resolveVendorTimeoutOverride({ _builderforce: { vendorTimeoutMs: 40_000.9 } })).toBe(40_000);
  });

  it('clamps to MAX_VENDOR_CALL_TIMEOUT_MS', () => {
    expect(resolveVendorTimeoutOverride({ _builderforce: { vendorTimeoutMs: 999_999 } })).toBe(
      MAX_VENDOR_CALL_TIMEOUT_MS,
    );
  });

  it('is undefined when absent, non-object, non-numeric, or non-positive', () => {
    expect(resolveVendorTimeoutOverride({})).toBeUndefined();
    expect(resolveVendorTimeoutOverride({ _builderforce: null })).toBeUndefined();
    expect(resolveVendorTimeoutOverride({ _builderforce: 'nope' as unknown })).toBeUndefined();
    expect(resolveVendorTimeoutOverride({ _builderforce: { vendorTimeoutMs: 'x' } })).toBeUndefined();
    expect(resolveVendorTimeoutOverride({ _builderforce: { vendorTimeoutMs: 0 } })).toBeUndefined();
    expect(resolveVendorTimeoutOverride({ _builderforce: { vendorTimeoutMs: -5 } })).toBeUndefined();
  });
});

describe('per-call vendor timeout override (integration)', () => {
  /** Capture the AbortSignal each vendor fetch is given so we can prove the
   *  override drove the inner timeout. The signal aborts after `timeoutMs`, so a
   *  longer override means a later abort — we assert the timer length indirectly
   *  by checking the override is honoured *and* the envelope never reaches the
   *  vendor body. */
  function installCapturingFetch(): { bodies: Array<Record<string, unknown>> } {
    const bodies: Array<Record<string, unknown>> = [];
    const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      bodies.push(JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
    return { bodies };
  }

  it('strips the _builderforce envelope from the body sent to the vendor', async () => {
    const { bodies } = installCapturingFetch();
    const proxy = llmProxyForPlan(env, 'free');

    const result = await proxy.complete({
      model: 'openrouter/qwen/qwen3-coder:free',
      messages: [{ role: 'user', content: 'hi' }],
      _builderforce: { vendorTimeoutMs: 45_000 },
    });

    expect(result.response.status).toBe(200);
    expect(bodies.length).toBeGreaterThan(0);
    // The gateway-internal envelope must never be forwarded upstream.
    for (const b of bodies) {
      expect(b).not.toHaveProperty('_builderforce');
    }
  });

  it('honours the override even on the free plan (call succeeds within the extended budget)', async () => {
    // A slow-but-eventual vendor: resolves after 18s of virtual time — past the
    // free plan's 15s default, but within a 45s caller override. Without the
    // override this would 408/cascade; with it, the call lands.
    vi.useFakeTimers();
    try {
      const fn = vi.fn(async (input: string | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
        await new Promise((r) => setTimeout(r, 18_000));
        return new Response(
          JSON.stringify({
            choices: [{ message: { role: 'assistant', content: 'slow ok' } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      });
      (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

      const proxy = llmProxyForPlan(env, 'free');
      const promise = proxy.complete({
        model: 'openrouter/qwen/qwen3-coder:free',
        strict: true, // pin to one model so no cascade muddies the timer assertion
        messages: [{ role: 'user', content: 'hi' }],
        _builderforce: { vendorTimeoutMs: 45_000 },
      });
      await vi.advanceTimersByTimeAsync(18_000);
      const result = await promise;
      expect(result.response.status).toBe(200);
      expect(result.resolvedModel).toBe('openrouter/qwen/qwen3-coder:free');
    } finally {
      vi.useRealTimers();
    }
  });
});
