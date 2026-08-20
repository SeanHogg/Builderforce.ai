import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminPoolProxy, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';

const originalFetch = globalThis.fetch;

afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  _resetMemoryCooldowns();
});

describe('removed model handling', () => {
  it('surfaces an all-410 cascade as 503 model_unavailable with real attempt details', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => new Response(
      JSON.stringify({ detail: 'model has reached end of life' }),
      { status: 410, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    const proxy = adminPoolProxy(
      { NVIDIA_API_KEY: 'nvapi-test' } as ProxyEnv,
      ['moonshotai/kimi-k2.6'],
      'builderforceLLM',
    );
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.response.status).toBe(503);
    expect(result.outcome).toBe('model_unavailable');
    expect(result.resolvedVendor).toBe('nvidia');
    expect(result.resolvedModel).toBe('moonshotai/kimi-k2.6');

    const body = await result.response.json() as {
      error: {
        code: string;
        type: string;
        reason: string;
        details: { failovers: Array<{ model: string; vendor: string; code: number; kind: string }> };
      };
    };
    expect(body.error.code).toBe('model_unavailable');
    expect(body.error.type).toBe('service_unavailable');
    expect(body.error.reason).toBe('all_models_unavailable');
    expect(body.error.details.failovers).toEqual([
      expect.objectContaining({
        model: 'moonshotai/kimi-k2.6',
        vendor: 'nvidia',
        code: 410,
        kind: 'client_error',
      }),
    ]);
  });
});
