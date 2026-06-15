import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// A model whose context window the request exceeds returns 413 ("estimated tokens
// exceeded this model context window limit"). That is per-model, not a bad payload:
// a bigger-window model can serve it, so 413 must CASCADE (it's in CASCADE_STATUSES),
// not hard-fail the run. The pool is ordered big-window-first so the failover lands
// on a model that fits. (Bug: a 97K coding context hitting a 32K Cloudflare model
// surfaced "Gateway 429" and the run was wrongly finalized.)
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  _resetMemoryCooldowns();
});

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

describe('a 413 context-window overflow cascades to the next model', () => {
  it('the first model 413s, the cascade advances and a later model answers', async () => {
    let call = 0;
    const fn = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      call++;
      if (call === 1) {
        // Context-window overflow on the first model.
        return new Response(
          JSON.stringify({ error: { message: 'estimated tokens (97272) exceeded this model context window limit (32768)' } }),
          { status: 413, headers: { 'content-type': 'application/json' } },
        );
      }
      // A later (bigger-window) model answers normally.
      return new Response(
        JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'free');
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.response.status).toBeLessThan(400); // did NOT hard-fail on the 413
    expect(call).toBeGreaterThan(1);                   // it cascaded past the 413
    expect(result.failovers.some((f) => f.code === 413)).toBe(true);
  });
});
