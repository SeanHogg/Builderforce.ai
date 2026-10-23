import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';

// Cost lever D7: `completeChat` answers a tool-free question a deterministic handler is
// sure of BEFORE the caches and the cascade — no vendor call, outcome `deterministic`,
// no usage. Lever off, or anything else, goes to a model exactly as before.

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  _resetMemoryCooldowns();
});

/** Every vendor call answers "model answer" — counted so the test can prove none happened. */
function installFetch(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => new Response(JSON.stringify({
    id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'model answer' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  }), { status: 200, headers: { 'content-type': 'application/json' } }));
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return fn;
}

const base: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

describe('completeChat — deterministic handlers (D7)', () => {
  it('answers arithmetic without dispatching, finalized with a trace and no usage', async () => {
    const fetchFn = installFetch();
    const proxy = llmProxyForPlan({ ...base, COST_LEVER_D7_DETERMINISTIC_HANDLERS: 'on' } as ProxyEnv, 'free');
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'what is 6 * 7?' }] });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.outcome).toBe('deterministic');
    expect(result.usage).toBeUndefined();
    expect(result.traceId).toBeTruthy();
    const body = await result.response.json() as { choices: Array<{ message: { content: string } }> };
    expect(body.choices[0]!.message.content).toBe('6 * 7 = 42');
  });

  it('goes to a model with the lever off', async () => {
    const fetchFn = installFetch();
    const proxy = llmProxyForPlan({ ...base, COST_LEVER_D7_DETERMINISTIC_HANDLERS: 'off' } as ProxyEnv, 'free');
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'what is 6 * 7?' }] });
    expect(fetchFn).toHaveBeenCalled();
    expect(result.outcome).not.toBe('deterministic');
  });

  it('goes to a model when tools are advertised', async () => {
    const fetchFn = installFetch();
    const proxy = llmProxyForPlan({ ...base, COST_LEVER_D7_DETERMINISTIC_HANDLERS: 'on' } as ProxyEnv, 'free');
    const result = await proxy.complete({
      messages: [{ role: 'user', content: 'what is 6 * 7?' }],
      tools: [{ type: 'function', function: { name: 'calc', parameters: { type: 'object' } } }],
    });
    expect(fetchFn).toHaveBeenCalled();
    expect(result.outcome).not.toBe('deterministic');
  });
});
