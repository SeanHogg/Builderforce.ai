import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, type ProxyEnv } from './LlmProxyService';
import {
  parseClientReasoningIntent,
  reasoningParamsForChain,
  reasoningParamsForModel,
} from './reasoningCapability';

// ---------------------------------------------------------------------------
// Client-supplied, VENDOR-NEUTRAL reasoning intent (the VS Code chat "Thinking"
// toggle): `POST /v1/chat/completions` may carry `reasoning: { level }`, omitted
// entirely when the toggle is off.
//
// The contract under test:
//   • absent/garbage        → request byte-identical to today (no param, no throw)
//   • the level is mapped by the EXISTING reasoningCapability registry against the
//     model the gateway RESOLVES, so an unsupported family silently drops it
//   • a mixed-family cascade drops it too — `thinking` must never leak onto a
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

// ── 2. Chain safety (the anti-leak guarantee) ──────────────────────────────
describe('reasoningParamsForChain', () => {
  const HIGH = { thinkLevel: 'high' } as const;

  it('emits the param for a single-model (strict-pin) chain', () => {
    expect(reasoningParamsForChain(['claude-opus-4-8'], HIGH))
      .toEqual({ thinking: { type: 'enabled', budget_tokens: 16384 } });
  });

  it('emits it for a homogeneous chain (every candidate resolves identically)', () => {
    expect(reasoningParamsForChain(['openai/gpt-5-nano', 'openai/o3'], HIGH))
      .toEqual({ reasoning_effort: 'high' });
  });

  it('DROPS it for a mixed chain — no thinking can leak onto a non-Anthropic coder', () => {
    expect(reasoningParamsForChain(['claude-opus-4-8', '@cf/qwen/qwen3-30b-a3b-fp8'], HIGH)).toBeUndefined();
    expect(reasoningParamsForChain(['claude-opus-4-8', 'deepseek/deepseek-v4-flash'], HIGH)).toBeUndefined();
    // Different vendor param shapes also disagree → drop.
    expect(reasoningParamsForChain(['claude-opus-4-8', 'openai/gpt-5-nano'], HIGH)).toBeUndefined();
  });

  it('drops for an unsupported-only chain or no intent', () => {
    expect(reasoningParamsForChain(['@cf/qwen/qwen3-30b-a3b-fp8'], HIGH)).toBeUndefined();
    expect(reasoningParamsForChain(['claude-opus-4-8'], undefined)).toBeUndefined();
    expect(reasoningParamsForChain([], HIGH)).toBeUndefined();
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

  it('a NON-pinned (cascading) request never leaks thinking to the chain', async () => {
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
