import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CODING_BACKSTOP_MODELS,
  CODING_FREE_ATTEMPT_BUDGET,
  FREE_ATTEMPT_BUDGET,
  FREE_MODEL_POOL,
  llmProxyForPlan,
  type ProxyEnv,
} from './LlmProxyService';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// Cost regression: a $10 Anthropic cap was drained because a coding run
// escalated to PAID coders — ending at the funded direct-Anthropic floor on a
// metered key — after only FREE_ATTEMPT_BUDGET (2) free coders, while ~9 free
// coders sat untried. A coding run is a long background job that values cost
// over a few seconds of latency, so it must walk the WHOLE free coding pool
// (CODING_FREE_ATTEMPT_BUDGET) before any paid/metered coder. The metered floor
// must be genuine last-resort: 10+ models tried first.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

/** Every OpenRouter call 429s, so the cascade walks its full free-coder budget. */
function install429Fetch(): void {
  const fn = vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
    return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  _resetMemoryCooldowns();
});

// Only OpenRouter is bound — NVIDIA/Cerebras/Cloudflare/Anthropic-direct models
// no-key-skip at dispatch, so the chain we observe is the OpenRouter free coders.
const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free' };

const freeCodersIn = (chain: readonly string[] | undefined): string[] =>
  (chain ?? []).filter((m) => FREE_MODEL_POOL.includes(m));

describe('coding runs exhaust the free coder pool before escalating', () => {
  it('CODING_FREE_ATTEMPT_BUDGET covers the whole free coding pool (≫ the general cap of 2)', () => {
    expect(CODING_FREE_ATTEMPT_BUDGET).toBeGreaterThan(FREE_ATTEMPT_BUDGET);
    expect(CODING_FREE_ATTEMPT_BUDGET).toBeGreaterThanOrEqual(6);
  });

  it('a coding proxy walks MORE than 2 free coders in its candidate chain', async () => {
    install429Fetch();
    const proxy = llmProxyForPlan(env, 'free', false, {
      codingOnly: true,
      backstopModels: CODING_BACKSTOP_MODELS,
    });

    const result = await proxy.complete({
      messages: [{ role: 'user', content: 'write code' }],
      tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object', properties: {} } } }],
    });

    // The general cap would have stopped at 2; coding must try its full free pool.
    expect(freeCodersIn(result.candidateChain).length).toBeGreaterThan(FREE_ATTEMPT_BUDGET);
  });

  it('a NON-coding proxy still caps free attempts at 2 (unchanged general behaviour)', async () => {
    install429Fetch();
    const proxy = llmProxyForPlan(env, 'free'); // no codingOnly → general cap

    const result = await proxy.complete({ messages: [{ role: 'user', content: 'hi' }] });

    expect(freeCodersIn(result.candidateChain).length).toBeLessThanOrEqual(FREE_ATTEMPT_BUDGET);
  });
});
