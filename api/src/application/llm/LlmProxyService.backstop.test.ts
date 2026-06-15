import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CODING_BACKSTOP_MODELS,
  CODING_PREMIUM_FALLBACK_MODELS,
  GUARANTEED_BACKSTOP_MODEL,
  PREMIUM_FALLBACK_MODELS,
  llmProxyForPlan,
  type ProxyEnv,
} from './LlmProxyService';

// ---------------------------------------------------------------------------
// Guaranteed paid backstop — the reliability floor that fixed hired.video's
// tailor `AI_UNAVAILABLE` failure. When the FREE plan's whole free pool is
// saturated (429/timeout), the primary cascade exhausts; the backstop must then
// dispatch a single paid model on the *credited* (Pro) OpenRouter key — even
// though the request came in on the free plan/key — and return a 200.
//
// Vendor calls are mocked via global fetch, branched on the request body's
// `model` + the Authorization header so we can assert "free key 429s, pro key
// answers." composeFreeCappedCascade has its own unit tests; here we verify the
// new complete()-level backstop integration.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

interface MockedCall {
  model: string;
  authKey: string;
}

/** Install a fetch that 200s only for the backstop model on the pro key; every
 *  other OpenRouter call 429s (saturated free pool). Returns the call log. */
function installSaturatedPoolFetch(proKey: string): MockedCall[] {
  const calls: MockedCall[] = [];
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
    const auth = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '');
    const authKey = auth.replace(/^Bearer\s+/, '');
    const model = body.model ?? '';
    calls.push({ model, authKey });

    if (model === GUARANTEED_BACKSTOP_MODEL && authKey === proKey) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'tailored resume' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    // Saturated free pool (and the free-key attempt at the paid backstop): 429.
    return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
      status: 429,
      headers: { 'content-type': 'application/json' },
    });
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return calls;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const env: ProxyEnv = {
  OPENROUTER_API_KEY: 'or-free',
  OPENROUTER_API_KEY_PRO: 'or-pro',
};

describe('guaranteed paid backstop', () => {
  it('free plan: saturated free pool falls back to the paid model on the credited (Pro) key', async () => {
    const calls = installSaturatedPoolFetch('or-pro');
    const proxy = llmProxyForPlan(env, 'free');

    const result = await proxy.complete({ messages: [{ role: 'user', content: 'tailor my resume' }] });

    expect(result.response.status).toBe(200);
    expect(result.resolvedModel).toBe(GUARANTEED_BACKSTOP_MODEL);
    expect(result.outcome).toBe('success');

    // The backstop call used the credited Pro key, not the free key the plan
    // would otherwise resolve to.
    const backstopCall = calls.find((c) => c.model === GUARANTEED_BACKSTOP_MODEL && c.authKey === 'or-pro');
    expect(backstopCall).toBeDefined();

    // The failover trace still records the primary cascade that was tried first.
    expect(result.failovers.length).toBeGreaterThan(0);
  });

  it('coding run: floors onto the CODING backstop (a coder), not the general-purpose backstop', async () => {
    // Regression for execution #59: a coding run whose coding cascade exhausted was
    // served by gemini-2.5-flash-lite (a non-coding general backstop) and gave up
    // without writing code. A coding proxy must floor onto a coder first.
    const codingFloor = CODING_BACKSTOP_MODELS[0]; // deepseek/deepseek-v4-flash
    expect(codingFloor).not.toBe(GUARANTEED_BACKSTOP_MODEL);
    const calls: MockedCall[] = [];
    const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      const authKey = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '').replace(/^Bearer\s+/, '');
      const model = body.model ?? '';
      calls.push({ model, authKey });
      // The coding floor answers on the credited key; everything else is saturated.
      if (model === codingFloor && authKey === 'or-pro') {
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'patch' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429, headers: { 'content-type': 'application/json' } });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'free', false, { backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true });
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'fix the bug' }] });

    expect(result.response.status).toBe(200);
    expect(result.resolvedModel).toBe(codingFloor);
    // The coder was tried on the credited key BEFORE the general backstop — gemini
    // is never even reached because the coder answered first.
    expect(calls.some((c) => c.model === codingFloor && c.authKey === 'or-pro')).toBe(true);
    expect(calls.some((c) => c.model === GUARANTEED_BACKSTOP_MODEL)).toBe(false);
  });

  it('coding run: the appended fallback chain is coders, NOT the general gemini chain', async () => {
    // The bug: a coding cascade resolved onto `googleai/gemini-2.5-flash` (a non-coder
    // in PREMIUM_FALLBACK_MODELS appended inline) and looped on search without writing
    // code. A codingOnly proxy must append CODING_PREMIUM_FALLBACK_MODELS (paid coders)
    // instead — so a non-coder is never even in the candidate chain.
    const codingFallback = CODING_PREMIUM_FALLBACK_MODELS[0]; // a coder, on OpenRouter
    const calls: MockedCall[] = [];
    const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      const body = JSON.parse(String(init?.body ?? '{}')) as { model?: string };
      const authKey = String((init?.headers as Record<string, string> | undefined)?.['Authorization'] ?? '').replace(/^Bearer\s+/, '');
      const model = body.model ?? '';
      calls.push({ model, authKey });
      // A coder in the appended fallback answers on the free key; everything else 429s.
      if (model === codingFallback) {
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'patch' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429, headers: { 'content-type': 'application/json' } });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'free', false, { backstopModels: CODING_BACKSTOP_MODELS, codingOnly: true });
    const result = await proxy.complete({ messages: [{ role: 'user', content: 'fix the bug' }] });

    expect(result.response.status).toBe(200);
    expect(result.resolvedModel).toBe(codingFallback);
    // No general non-coder gemini model from PREMIUM_FALLBACK_MODELS was ever attempted.
    expect(calls.some((c) => PREMIUM_FALLBACK_MODELS.includes(c.model))).toBe(false);
  });

  it('returns the original failure when no credited key is bound (nothing to fall back to)', async () => {
    installSaturatedPoolFetch('or-pro'); // pro key would answer, but env has none
    const proxy = llmProxyForPlan({ OPENROUTER_API_KEY: 'or-free' }, 'free');

    const result = await proxy.complete({ messages: [{ role: 'user', content: 'tailor my resume' }] });

    expect(result.response.status).toBe(429);
    expect(result.outcome).toBe('cascade_exhausted');
  });
});
