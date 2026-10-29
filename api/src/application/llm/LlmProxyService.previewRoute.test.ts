import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';

// previewRoute is the no-dispatch twin of complete(): the same seed + candidate chain, never a
// fetch. It prices a call before it is made (PRD 38 confirm chip).
const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});
const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };
const messages = [{ role: 'user' as const, content: 'x' }];

describe('LlmProxyService.previewRoute', () => {
  it('lists the models the request would try, in order, without any model call', async () => {
    const fetchSpy = vi.fn(async () => { throw new Error('a preview must not dispatch'); });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    const chain = await llmProxyForPlan(env, 'pro').previewRoute({ messages });
    expect(chain.length).toBeGreaterThan(0);
    expect(new Set(chain).size).toBe(chain.length);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a strict pin previews as that single model', async () => {
    expect(await llmProxyForPlan(env, 'pro').previewRoute({ model: 'cerebras/llama-3.3-70b', strict: true, messages })).toEqual(['cerebras/llama-3.3-70b']);
  });
});
