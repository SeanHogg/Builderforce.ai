import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns, loadCooledVendors } from '../../infrastructure/auth/cooldownStore';
import type { VendorId } from './vendors';

// ---------------------------------------------------------------------------
// Execution #73: a cloud coding run floored onto the direct-Anthropic backstop
// when that account hit its monthly usage cap. Anthropic returns the cap as an
// HTTP 400 `invalid_request_error` ("You have reached your specified API usage
// limits. You will regain access on 2026-07-01"), which the gateway classified
// as a CALLER request error — short-circuiting the cascade BEFORE the paid
// backstop and writing no cooldown. The run died with a misleading fatal 400
// instead of failing over to another provider.
//
// A usage-cap / credit-balance 400 is a CAPACITY condition (the request is fine;
// a different vendor can serve it), so the gateway now treats it as retryable:
//   - the cascade fails over (and the paid backstop on the credited key fires),
//   - the vendor is cooled like a 429 (recovers later),
//   - the surfaced outcome is a 429 cascade-exhausted, NOT a fatal 400.
//
// Mirrors LlmProxyService.requestError.test.ts (the genuine-malformed-400 case)
// to lock the boundary between the two.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** The exact Anthropic usage-cap payload, served as a 400 from every call. */
const USAGE_CAP_BODY = JSON.stringify({
  error: {
    type: 'invalid_request_error',
    message:
      'You have reached your specified API usage limits. You will regain access on 2026-07-01 at 00:00 UTC.',
  },
});

function installCapacityLimitFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
    return new Response(USAGE_CAP_BODY, { status: 400, headers: { 'content-type': 'application/json' } });
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  _resetMemoryCooldowns();
});

const env: ProxyEnv = {
  OPENROUTER_API_KEY: 'or-free',
  OPENROUTER_API_KEY_PRO: 'or-pro',
};

describe('a capacity/usage-limit 400 fails over instead of hard-failing', () => {
  it('does NOT surface a fatal request_error 400 (it is a capacity condition, not a bad payload)', async () => {
    installCapacityLimitFetch();
    const proxy = llmProxyForPlan(env, 'free');

    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.outcome).not.toBe('request_error');
    expect(result.response.status).not.toBe(400);
  });

  it('attempts the paid backstop on the credited key (another provider IS used)', async () => {
    const fn = installCapacityLimitFetch();
    const proxy = llmProxyForPlan(env, 'free');

    await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    // The bug short-circuited before the backstop. A capacity limit must let the
    // cascade fall through to the funded backstop, which re-issues on the
    // credited (or-pro) key — proof the gateway tried another provider.
    const usedProKey = fn.mock.calls.some(([, init]) => {
      const auth = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '');
      return auth.includes('or-pro');
    });
    expect(usedProKey).toBe(true);
  });

  it('cools the whole capped VENDOR on the first strike so the next run stands down', async () => {
    installCapacityLimitFetch();
    const proxy = llmProxyForPlan(env, 'free');

    await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    // request_error writes NO cooldown at all; a capacity limit is a property of
    // the whole KEY (the account is out of budget), so a SINGLE strike must trip
    // the vendor cooldown — every model on that key is unreachable until it
    // resets. This is what stops the gateway re-reaching, and re-spending on, a
    // metered key that has hit its monthly cap.
    const cooled = await loadCooledVendors(env, ['openrouter' as VendorId]);
    expect(cooled.has('openrouter')).toBe(true);
  });
});
