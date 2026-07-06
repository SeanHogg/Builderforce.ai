import { afterEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, CODING_BACKSTOP_MODELS, type ProxyEnv } from './LlmProxyService';

// ---------------------------------------------------------------------------
// Connected-account (BYO subscription) dispatch — the REAL proxy path.
//
// Reproduces exactly how BrainService.agentReply builds its proxy: a FREE plan
// tenant with a connected Claude subscription (`anthropicOAuthToken`), codingOnly,
// no explicit model — so the connected flagship (claude-opus-4-8) is auto-seeded at
// the head of the cascade. Vendor HTTP is mocked via global fetch so we prove, through
// the real complete() → dispatch() → anthropic-vendor code, that:
//   1. a WORKING connected account actually serves the turn ($0, byo), and
//   2. a FAILING connected account is attributed HONESTLY in `failovers` (real status +
//      detail, or the code-0 network detail) rather than a contentless "no response".
//
// This is the regression coverage that the production "ran on @cf/qwen, connected
// account errored (no response)" symptom lacked — it drives the same code the Worker
// runs, deterministically, with no live endpoint.
// ---------------------------------------------------------------------------

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

// Env with an OpenRouter free key so the shared coding pool is a REACHABLE fallback
// when the connected account fails (mirrors the cloud default).
const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

/** A tenant proxy built the way BrainService.agentReply builds it. */
function connectedProxy() {
  return llmProxyForPlan(env, 'free', false, {
    codingOnly: true,
    backstopModels: CODING_BACKSTOP_MODELS,
    anthropicOAuthToken: 'sk-ant-oat-test-token',
  });
}

/** Anthropic Messages 200 body (native shape — the vendor translates it). */
function anthropicOk(text: string) {
  return new Response(
    JSON.stringify({ id: 'msg_1', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 2 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

/** OpenAI-shaped 200 (OpenRouter / the shared pool). */
function openaiOk(content: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content } }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

const request = {
  // No `model` → the connected flagship is auto-seeded at the head.
  messages: [{ role: 'user' as const, content: 'Plan the sprint.' }],
  tools: [{ type: 'function' as const, function: { name: 'noop', description: 'no-op', parameters: { type: 'object', properties: {} } } }],
};

describe('connected account — happy path serves the turn (real dispatch)', () => {
  it('auto-seeds claude-opus-4-8 and RESOLVES on the connected Anthropic account ($0/byo)', async () => {
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const model = (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model ?? '';
      seen.push(`${url.includes('anthropic') ? 'anthropic' : 'other'}:${model}`);
      if (url === ANTHROPIC_ENDPOINT) return anthropicOk('planned');
      throw new Error(`unexpected fetch (connected account should have served): ${url} ${model}`);
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await connectedProxy().complete(request);

    expect(result.response.status).toBe(200);
    expect(result.resolvedVendor).toBe('anthropic');
    expect(result.resolvedModel).toBe('claude-opus-4-8');
    // The connected account was the FIRST (and only) thing tried — no shadowing by a
    // free @cf/* coder, no cascade to the shared pool.
    expect(seen[0]).toBe('anthropic:claude-opus-4-8');
    // The auth header proves the subscription (OAuth) token was used, not an api key.
    const h = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(h['authorization']).toBe('Bearer sk-ant-oat-test-token');
  });
});

describe('connected account — failure is attributed HONESTLY (real dispatch)', () => {
  it('a 400 on the connected account carries the real status + detail into failovers, then falls back', async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ANTHROPIC_ENDPOINT) {
        return new Response(JSON.stringify({ error: { message: 'system: first block must be Claude Code identity' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      return openaiOk('fallback reply'); // shared pool serves the fallback
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await connectedProxy().complete(request);

    // It fell back off the connected account…
    expect(result.resolvedVendor).not.toBe('anthropic');
    // …and the connected-account failure is recorded WITH its real status + detail,
    // so a diagnostic can say WHY instead of "no response".
    const anthropicFo = result.failovers.find((f) => f.vendor === 'anthropic');
    expect(anthropicFo).toBeTruthy();
    expect(anthropicFo!.code).toBe(400);
    expect(anthropicFo!.detail).toContain('Claude Code identity');
  });

  it('a THROWN fetch (code-0 "no response") on the connected account carries the network detail', async () => {
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ANTHROPIC_ENDPOINT) throw new TypeError('Network connection lost.');
      return openaiOk('fallback reply');
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await connectedProxy().complete(request);

    const anthropicFo = result.failovers.find((f) => f.vendor === 'anthropic');
    expect(anthropicFo).toBeTruthy();
    expect(anthropicFo!.code).toBe(0);
    // The detail is the ONLY thing that distinguishes this from a skip — it must carry
    // the thrown cause, not be empty.
    expect(anthropicFo!.detail).toContain('Network connection lost');
  });
});
