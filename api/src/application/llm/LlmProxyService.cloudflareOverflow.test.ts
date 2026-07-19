import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CODING_BACKSTOP_MODELS,
  llmProxyForPlan,
  type ProxyEnv,
} from './LlmProxyService';
import { vendorForModel } from './vendors';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// "Are you even calling Cloudflare?" — yes, and it must absorb coding overflow
// on its FREE daily neuron allowance BEFORE the metered direct-Anthropic floor.
// Cloudflare (`@cf/...`) is PAID_LEAD_VENDOR and leads CODING_PREMIUM_FALLBACK_MODELS,
// so when the free coders are saturated the cascade lands on the Cloudflare coder
// and NEVER reaches `claude-sonnet-5` / `claude-opus-4-8` on the operator's
// CLAUDE_API_KEY. This regression-locks both the wiring (CF env passed through)
// and the ordering (CF before Anthropic). The metered floor is reached ONLY when
// Cloudflare is unbound or down — which the health probe surfaces as
// `cloudflare: unconfigured` / `down`.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const CF_ACCOUNT = 'acct-test';
// Cloudflare now uses its OpenAI-compatible endpoint (model in the body, not the path).
const CF_ENDPOINT = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/v1/chat/completions`;

interface Counters {
  cloudflare: number;
  anthropic: number;
}

/** OpenRouter 429s (free + OR-routed paid coders saturated); Cloudflare answers
 *  200; Anthropic answers 200 too — so the ONLY reason CF wins is the ordering. */
function installFetch(counters: Counters): void {
  const fn = vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === OPENROUTER_ENDPOINT) {
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 });
    }
    if (url === CF_ENDPOINT) {
      counters.cloudflare++;
      // OpenAI-compatible response shape (the endpoint is OpenAI-compatible now).
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'done' } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }
    if (url === ANTHROPIC_ENDPOINT) {
      counters.anthropic++;
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'claude reply' }], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unmocked fetch: ${url}`);
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  _resetMemoryCooldowns();
});

// Cloudflare + Anthropic-direct BOTH bound — so reaching Anthropic would be a
// real (billable) call, not a no-key-skip. The only thing keeping spend off the
// metered key is the cascade ordering.
const env: ProxyEnv = {
  OPENROUTER_API_KEY: 'or-free',
  OPENROUTER_API_KEY_PRO: 'or-pro',
  CLOUDFLARE_AI_API_TOKEN: 'cf-token',
  CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT,
  CLAUDE_API_KEY: 'sk-ant-test',
};

describe('Cloudflare absorbs coding overflow before the metered Anthropic floor', () => {
  it('resolves a saturated coding run on the free Cloudflare coder, never on Anthropic', async () => {
    const counters: Counters = { cloudflare: 0, anthropic: 0 };
    installFetch(counters);
    const proxy = llmProxyForPlan(env, 'free', false, {
      codingOnly: true,
      backstopModels: CODING_BACKSTOP_MODELS,
    });

    const result = await proxy.complete({
      messages: [{ role: 'user', content: 'write code' }],
      tools: [{ type: 'function', function: { name: 'noop', parameters: { type: 'object', properties: {} } } }],
    });

    expect(result.response.status).toBeLessThan(400);
    // Resolves on a Cloudflare coder (the big-window CF coder leads the fallback) —
    // model-agnostic so a reorder of the CF coding set doesn't break this.
    expect(vendorForModel(result.resolvedModel)).toBe('cloudflare');
    expect(counters.cloudflare).toBeGreaterThan(0);
    // The metered key must NOT have been billed — Cloudflare led the fallback.
    expect(counters.anthropic).toBe(0);
  });
});
