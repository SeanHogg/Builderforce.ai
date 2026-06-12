import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns, loadCooledVendors } from '../../infrastructure/auth/cooldownStore';
import type { VendorId } from './vendors';

// ---------------------------------------------------------------------------
// Gap [1230]: a 400/422 is the CALLER's malformed payload, not vendor
// saturation. When every candidate rejects it as a request error the gateway
// must surface a FATAL 4xx (with the upstream's schema diagnostic) so the
// caller can fix their request — NOT a generic 429 cascade-exhausted that
// implies "retry later" and invites a doomed loop. It must also write NO vendor
// cooldown (which would starve other tenants on that upstream for one bad body).
//
// Vendor calls are mocked via global fetch. The OpenRouter transport maps a 400
// to a VendorFatalError (failover can't fix a malformed request), which the
// proxy now converts into a fatal 4xx instead of a 429.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Every OpenRouter call returns the given 4xx with a schema-ish diagnostic. */
function installRequestErrorFetch(status: number): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
    return new Response(
      JSON.stringify({ error: { message: 'messages[0].role: invalid enum value "boss"', type: 'invalid_request_error' } }),
      { status, headers: { 'content-type': 'application/json' } },
    );
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

describe('all-request-error cascade surfaces a fatal 4xx', () => {
  it('400 from every candidate → 400 to the caller (not a 429 cascade-exhausted)', async () => {
    installRequestErrorFetch(400);
    const proxy = llmProxyForPlan(env, 'free');

    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.response.status).toBe(400);
    expect(result.outcome).toBe('request_error');

    const body = (await result.response.json()) as { error?: { code?: number; type?: string; message?: string } };
    expect(body.error?.code).toBe(400);
    expect(body.error?.type).toBe('invalid_request_error');
    // The upstream's actionable schema diagnostic is preserved for the caller.
    expect(body.error?.message).toContain('invalid enum value');
  });

  it('422 is treated the same way as 400', async () => {
    installRequestErrorFetch(422);
    const proxy = llmProxyForPlan(env, 'free');

    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.response.status).toBe(422);
    expect(result.outcome).toBe('request_error');
  });

  it('does NOT fire the paid backstop on a request error (the backstop would 400 too)', async () => {
    const fn = installRequestErrorFetch(400);
    const proxy = llmProxyForPlan(env, 'free');

    await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    // Backstop dispatch would re-issue on GUARANTEED_BACKSTOP_MODEL with the
    // credited (or-pro) key. A request error must short-circuit BEFORE that, so
    // no call should ever have used the pro key.
    const usedProKey = fn.mock.calls.some(([, init]) => {
      const auth = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '');
      return auth.includes('or-pro');
    });
    expect(usedProKey).toBe(false);
  });

  it('writes NO vendor cooldown for a request error', async () => {
    installRequestErrorFetch(400);
    const proxy = llmProxyForPlan(env, 'free');

    await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    const cooled = await loadCooledVendors(env, ['openrouter' as VendorId]);
    expect(cooled.has('openrouter')).toBe(false);
  });
});
