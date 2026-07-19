import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';
import { parseClientReasoningIntent, reasoningParamsForModel } from './reasoningCapability';
import { dispatchVendor } from './vendors/registry';
import type { VendorEnv } from './vendors/types';

// ---------------------------------------------------------------------------
// Client-supplied, VENDOR-NEUTRAL reasoning intent (the VS Code chat "Thinking"
// toggle): `POST /v1/chat/completions` may carry `reasoning: { level }`, omitted
// entirely when the toggle is off.
//
// The contract under test:
//   • absent/garbage        → request byte-identical to today (no param, no throw)
//   • the level is mapped by the EXISTING reasoningCapability registry against the
//     model the gateway RESOLVES, so an unsupported family silently drops it
//   • the intent is carried into the CASCADE and resolved PER FAILOVER ATTEMPT, so a
//     mixed-family chain sends the right param on each supported hop and NOTHING on a
//     Cloudflare/deepseek/qwen coder that would reject it.
//
// Vendor calls are mocked via global fetch so the assertions are on the REAL
// outgoing vendor body.
// ---------------------------------------------------------------------------

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

const env: ProxyEnv = {
  OPENROUTER_API_KEY: 'or-free',
  OPENROUTER_API_KEY_PRO: 'or-pro',
  CLAUDE_API_KEY: 'sk-ant-test',
};

/** Capture the body of whichever vendor endpoint gets called. */
function captureVendorBody(): { get: () => Record<string, any> | null; calls: () => number } {
  let captured: Record<string, any> | null = null;
  let calls = 0;
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls++;
    captured = JSON.parse(String(init?.body ?? '{}'));
    if (url === ANTHROPIC_ENDPOINT) {
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (url === OPENROUTER_ENDPOINT) {
      return new Response(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`unmocked fetch: ${url}`);
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { get: () => captured, calls: () => calls };
}

/** Strict-pin a model so the resolved chain is exactly one model (no cascade). */
async function completePinned(model: string, reasoning?: unknown) {
  const cap = captureVendorBody();
  const proxy = llmProxyForPlan(env, 'pro');
  const result = await proxy.complete({
    model,
    strict: true,
    messages: [{ role: 'user', content: 'Refactor the avatar filter.' }],
    ...(reasoning !== undefined ? { reasoning } as Record<string, unknown> : {}),
  });
  return { body: cap.get(), status: result.response.status, resolvedModel: result.resolvedModel };
}

// ── 1. Parsing / validation ────────────────────────────────────────────────
describe('parseClientReasoningIntent', () => {
  it('accepts the three vendor-neutral levels as AgentExecParams levers', () => {
    expect(parseClientReasoningIntent({ level: 'low' })).toEqual({ thinkLevel: 'low' });
    expect(parseClientReasoningIntent({ level: 'medium' })).toEqual({ thinkLevel: 'medium' });
    expect(parseClientReasoningIntent({ level: 'high' })).toEqual({ thinkLevel: 'high' });
    expect(parseClientReasoningIntent({ level: ' HIGH ' })).toEqual({ thinkLevel: 'high' });
  });

  it('ignores absent / malformed / unknown input without throwing', () => {
    for (const raw of [
      undefined, null, 'high', 42, [], {}, { level: null }, { level: 'off' },
      { level: 'xhigh' }, { level: 'ultra' }, { level: '' },
      { level: 'high; drop table' },
      // a caller trying to smuggle a vendor param through the field
      { level: 'high', budget_tokens: 999_999 },
    ]) {
      expect(() => parseClientReasoningIntent(raw)).not.toThrow();
    }
    expect(parseClientReasoningIntent(undefined)).toBeUndefined();
    expect(parseClientReasoningIntent({ level: 'off' })).toBeUndefined();
    expect(parseClientReasoningIntent({ level: 'ultra' })).toBeUndefined();
    // Only the matched union member survives — extra client keys are dropped.
    expect(parseClientReasoningIntent({ level: 'high', budget_tokens: 999_999 }))
      .toEqual({ thinkLevel: 'high' });
  });
});

// ── 2. PER-ATTEMPT derivation inside the cascade (the anti-leak guarantee) ──
//
// This is the case that motivated the design: the dispatcher walks the candidate
// chain internally on failover, so the reasoning param CANNOT be computed once for
// the chain — it is derived for each model actually tried. Every candidate below is
// forced to fail (429) so the walk visits ALL of them and we can inspect each
// outgoing body.
describe('dispatchVendor derives the reasoning param per failover attempt', () => {
  const CASCADE_ENV: VendorEnv = {
    CLAUDE_API_KEY: 'sk-ant-test',
    OPENROUTER_API_KEY: 'or-test',
    CLOUDFLARE_AI_API_TOKEN: 'cfut_test',
    CLOUDFLARE_ACCOUNT_ID: 'acct-test',
  };

  /** Fail every vendor call with a cascade-eligible 429, recording each body by URL. */
  function captureCascade(): Array<{ url: string; body: Record<string, any> }> {
    const seen: Array<{ url: string; body: Record<string, any> }> = [];
    const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      seen.push({
        url: typeof input === 'string' ? input : input.toString(),
        body: JSON.parse(String(init?.body ?? '{}')),
      });
      return new Response('rate limited', { status: 429 });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
    return seen;
  }

  async function walk(
    modelChain: string[],
    reasoningIntent?: Record<string, unknown>,
    extraBody?: Record<string, unknown>,
  ) {
    const seen = captureCascade();
    await expect(dispatchVendor({
      env: CASCADE_ENV,
      modelChain,
      messages: [{ role: 'user', content: 'Refactor the avatar filter.' }],
      maxTokens: 1024,
      ...(extraBody ? { extraBody } : {}),
      ...(reasoningIntent ? { reasoningIntent } as never : {}),
    })).rejects.toThrow(/cascade exhausted/i);
    expect(seen).toHaveLength(modelChain.length);
    return seen;
  }

  const HIGH = { execParams: { thinkLevel: 'high' as const }, isFirstTurn: true };

  it('MIXED chain [claude-opus-4-8, @cf/qwen/…]: thinking on the Anthropic hop, NOTHING on the Cloudflare failover', async () => {
    const [anthropic, cloudflare] = await walk(
      ['claude-opus-4-8', '@cf/qwen/qwen3-30b-a3b-fp8'],
      HIGH,
    );

    // Anthropic attempt — native extended thinking at the `high` budget.
    expect(anthropic!.url).toBe(ANTHROPIC_ENDPOINT);
    expect(anthropic!.body.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });

    // Cloudflare failover — no reasoning param of ANY kind, and no leaked hint.
    expect(cloudflare!.url).toContain('api.cloudflare.com');
    expect(cloudflare!.body.thinking).toBeUndefined();
    expect(cloudflare!.body.reasoning_effort).toBeUndefined();
    expect(cloudflare!.body.reasoning).toBeUndefined();
    expect(cloudflare!.body.firstTurn).toBeUndefined();
    expect(cloudflare!.body.budget_tokens).toBeUndefined();
  });

  it('MIXED chain [gpt-5, claude-opus-4-8]: each hop gets its OWN param shape', async () => {
    const [openai, anthropic] = await walk(['gpt-5', 'claude-opus-4-8'], HIGH);

    // OpenAI-shaped hop → reasoning_effort only.
    expect(openai!.body.reasoning_effort).toBe('high');
    expect(openai!.body.thinking).toBeUndefined();

    // Anthropic hop → thinking only (no reasoning_effort crossing over).
    expect(anthropic!.url).toBe(ANTHROPIC_ENDPOINT);
    expect(anthropic!.body.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });
    expect(anthropic!.body.reasoning_effort).toBeUndefined();
  });

  it('an unsupported-only chain gets no param on any hop', async () => {
    const seen = await walk(['@cf/qwen/qwen3-30b-a3b-fp8', 'deepseek/deepseek-v4-flash'], HIGH);
    for (const { body } of seen) {
      expect(body.thinking).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
    }
  });

  it('ABSENT intent → every attempt is byte-identical to the same walk without the field', async () => {
    const chain = ['claude-opus-4-8', '@cf/qwen/qwen3-30b-a3b-fp8', 'gpt-5'];
    const withoutField = await walk(chain);
    const withUndefined = await walk(chain, undefined);
    expect(withUndefined.map((s) => JSON.stringify(s.body)))
      .toEqual(withoutField.map((s) => JSON.stringify(s.body)));
    for (const { body } of withoutField) {
      expect(body.reasoning_effort).toBeUndefined();
      expect(body.reasoning).toBeUndefined();
    }
  });

  // `isFirstTurn` is threaded to vendors/anthropic.ts so extended thinking is safe on a
  // planning turn but OFF on a continuation turn whose thinking block was lost in the
  // OpenAI round-trip (which would 400). It only bites when tools are present.
  // (Tools reach the Anthropic translator via `extraBody` — see toAnthropicRequest.)
  const TOOLS = { tools: [{ type: 'function', function: { name: 'read_file', parameters: { type: 'object' } } }] };

  it('isFirstTurn=true + tools → thinking stays ON for the Anthropic hop', async () => {
    const [anthropic] = await walk(['claude-opus-4-8'], HIGH, TOOLS);
    expect(anthropic!.body.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });
    // The caller's own extraBody survives the per-attempt merge.
    expect(anthropic!.body.tools).toHaveLength(1);
  });

  it('isFirstTurn=false + tools → the Anthropic hop DISABLES thinking; the hint never reaches an OpenAI-shaped hop', async () => {
    const [openai, anthropic] = await walk(
      ['gpt-5', 'claude-opus-4-8'],
      { execParams: { thinkLevel: 'high' }, isFirstTurn: false },
      TOOLS,
    );
    // The hint rides the anthropic branch only — an OpenAI-shaped vendor gets
    // `reasoning_effort` and nothing else.
    expect(openai!.body.reasoning_effort).toBe('high');
    expect(openai!.body.firstTurn).toBeUndefined();
    expect(anthropic!.body.thinking).toEqual({ type: 'disabled' });
    expect(anthropic!.body.firstTurn).toBeUndefined();
  });
});

// ── 3. Per-family mapping through the registry (no second table) ───────────
describe('level → vendor param per model family', () => {
  it('maps the client levels via the SAME registry the cloud loop uses', () => {
    const high = parseClientReasoningIntent({ level: 'high' });
    const medium = parseClientReasoningIntent({ level: 'medium' });
    expect(reasoningParamsForModel('claude-opus-4-8', high))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 16384 } });
    expect(reasoningParamsForModel('claude-sonnet-5', high)).toBeUndefined();       // adaptive-only
    expect(reasoningParamsForModel('anthropic/claude-sonnet-5', high)).toBeUndefined(); // OpenRouter shape
    expect(reasoningParamsForModel('gpt-5', medium)).toEqual({ reasoning_effort: 'medium' });
    expect(reasoningParamsForModel('@cf/qwen/qwen3-30b-a3b-fp8', high)).toBeUndefined();
  });
});

// ── 4. End-to-end through the gateway (real outgoing vendor body) ──────────
describe('gateway chat/completions honours the client reasoning intent', () => {
  it('leaves the request UNCHANGED when the field is absent', async () => {
    const without = await completePinned('claude-opus-4-8');
    const withOff = await completePinned('claude-opus-4-8', undefined);
    expect(without.body?.thinking).toEqual({ type: 'disabled' });
    expect(without.body).toHaveProperty('max_tokens');
    expect(without.body?.reasoning).toBeUndefined();
    expect(withOff.body).toEqual(without.body);
  });

  it('level=high + bare claude-* → Anthropic extended thinking at the high budget', async () => {
    const { body } = await completePinned('claude-opus-4-8', { level: 'high' });
    expect(body?.thinking).toEqual({ type: 'enabled', budget_tokens: 16384 });
    // Anthropic requires max_tokens > budget — the vendor bumps it to fit.
    expect(body?.max_tokens).toBeGreaterThan(16384);
    // The raw client field never reaches the vendor.
    expect(body?.reasoning).toBeUndefined();
  });

  it('level=high + claude-sonnet-5 (adaptive-only) → NO thinking param', async () => {
    const { body } = await completePinned('claude-sonnet-5', { level: 'high' });
    expect(body?.thinking).toEqual({ type: 'disabled' });
  });

  it('level=high + OpenRouter anthropic/claude-* → NO param (it speaks the OpenAI shape)', async () => {
    const { body } = await completePinned('anthropic/claude-sonnet-5', { level: 'high' });
    expect(body?.thinking).toBeUndefined();
    expect(body?.reasoning_effort).toBeUndefined();
    expect(body?.reasoning).toBeUndefined();
  });

  it('level=medium + gpt-5 family → reasoning_effort: medium', async () => {
    const { body } = await completePinned('openai/gpt-5-nano', { level: 'medium' });
    expect(body?.reasoning_effort).toBe('medium');
    expect(body?.thinking).toBeUndefined();
  });

  it('level=high + a Cloudflare coder → NO reasoning param of any kind', async () => {
    const { body } = await completePinned('openai/gpt-4.1', { level: 'high' }); // non-reasoning OpenAI
    expect(body?.reasoning_effort).toBeUndefined();
    expect(body?.thinking).toBeUndefined();
    expect(body?.reasoning).toBeUndefined();
  });

  it('garbage level is ignored — no throw, no param, no passthrough', async () => {
    const { body, status } = await completePinned('claude-opus-4-8', { level: 'ludicrous', budget_tokens: 1 });
    expect(status).toBeLessThan(400);
    expect(body?.thinking).toEqual({ type: 'disabled' });
    expect(body?.reasoning).toBeUndefined();
    expect(body?.budget_tokens).toBeUndefined();
  });

  it('a NON-pinned (auto) request sends nothing to a model whose family has no reasoning param', async () => {
    const cap = captureVendorBody();
    const proxy = llmProxyForPlan(env, 'pro');
    await proxy.complete({
      messages: [{ role: 'user', content: 'hello' }],
      reasoning: { level: 'high' },
    } as Record<string, unknown> as never);
    const body = cap.get();
    expect(body?.thinking).toBeUndefined();
    expect(body?.firstTurn).toBeUndefined();
    expect(body?.reasoning).toBeUndefined();
  });
});
