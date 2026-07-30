import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, CODING_BACKSTOP_MODELS, type ProxyEnv } from './LlmProxyService';
import { _resetMemoryCooldowns, recordFailure } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// Connected-account (BYO subscription) dispatch — the REAL proxy path.
//
// Reproduces exactly how BrainService.agentReply builds its proxy: a FREE plan
// tenant with a connected Claude subscription (`anthropicOAuthToken`), codingOnly,
// no explicit model — so the connected flagship (claude-opus-5) is auto-seeded at
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
const XAI_OAUTH_ENDPOINT = 'https://api.x.ai/v1/responses';
const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });
// Cooldowns live in a module-level map when KV isn't bound, so one test's recorded
// failure would otherwise bench a model for the next one.
beforeEach(() => { _resetMemoryCooldowns(); });

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
  it('auto-seeds claude-opus-5 and RESOLVES on the connected Anthropic account ($0/byo)', async () => {
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
    expect(result.resolvedModel).toBe('claude-opus-5');
    // The connected account was the FIRST (and only) thing tried — no shadowing by a
    // free @cf/* coder, no cascade to the shared pool.
    expect(seen[0]).toBe('anthropic:claude-opus-5');
    // The auth header proves the subscription (OAuth) token was used, not an api key.
    const h = fetchSpy.mock.calls[0]![1]?.headers as Record<string, string>;
    expect(h['authorization']).toBe('Bearer sk-ant-oat-test-token');
  });
});

describe('connected account — a non-BYO caller model does NOT shadow the connected flagship', () => {
  it('a request carrying a NON-BYO model (e.g. the Brain default coder) still auto-seeds claude-opus-5', async () => {
    // The exact VS Code Brain regression: a tenant with a connected Claude account whose
    // request carries a non-Anthropic default `model` (a stale/free coder) must NOT let
    // that model shadow the connected flagship — otherwise the turn silently runs the weak
    // coder and Opus never leads. The caller model is a hint that drops BEHIND the flagship.
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const model = (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model ?? '';
      seen.push(`${url.includes('anthropic') ? 'anthropic' : 'other'}:${model}`);
      if (url === ANTHROPIC_ENDPOINT) return anthropicOk('planned');
      throw new Error(`unexpected fetch (connected account should have led): ${url} ${model}`);
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await connectedProxy().complete({
      ...request,
      // A non-BYO coder pin — the kind resolveEffectiveModel/defaultModel can send.
      model: 'deepseek/deepseek-v4-flash-20260423',
    });

    expect(result.response.status).toBe(200);
    expect(result.resolvedVendor).toBe('anthropic');
    expect(result.resolvedModel).toBe('claude-opus-5');
    // Opus led the cascade despite the non-BYO caller model.
    expect(seen[0]).toBe('anthropic:claude-opus-5');
  });
});

describe('connected account — failure stays inside the BYO boundary', () => {
  it('a 400 on the connected account carries the real status + detail and never calls the shared pool', async () => {
    const sharedCalls: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ANTHROPIC_ENDPOINT) {
        return new Response(JSON.stringify({ error: { message: 'system: first block must be Claude Code identity' } }), { status: 400, headers: { 'content-type': 'application/json' } });
      }
      sharedCalls.push(url);
      return openaiOk('must not be used');
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await connectedProxy().complete(request);

    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(sharedCalls).toEqual([]);
    // The connected-account failure is recorded WITH its real status + detail,
    // so a diagnostic can say WHY instead of "no response".
    const anthropicFo = result.failovers.find((f) => f.vendor === 'anthropic');
    expect(anthropicFo).toBeTruthy();
    expect(anthropicFo!.code).toBe(400);
    expect(anthropicFo!.detail).toContain('Claude Code identity');
  });

  it('a THROWN fetch carries the network detail and never calls the shared pool', async () => {
    const sharedCalls: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ANTHROPIC_ENDPOINT) throw new TypeError('Network connection lost.');
      sharedCalls.push(url);
      return openaiOk('must not be used');
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await connectedProxy().complete(request);

    const anthropicFo = result.failovers.find((f) => f.vendor === 'anthropic');
    expect(anthropicFo).toBeTruthy();
    expect(anthropicFo!.code).toBe(0);
    // The detail is the ONLY thing that distinguishes this from a skip — it must carry
    // the thrown cause, not be empty.
    expect(anthropicFo!.detail).toContain('Network connection lost');
    expect(sharedCalls).toEqual([]);
  });
});

describe('MULTIPLE connected accounts fail over to each other', () => {
  /** Anthropic (subscription) + xAI SuperGrok (subscription), Anthropic first. */
  function twoAccountProxy() {
    return llmProxyForPlan(env, 'free', false, {
      codingOnly: true,
      backstopModels: CODING_BACKSTOP_MODELS,
      anthropicOAuthToken: 'sk-ant-oat-test-token',
      xaiOAuthToken: 'xai-oat-test-token',
      byoRequired: true,
    });
  }

  /** xAI Responses-API 200 (the shape the xai-oauth vendor parses). */
  function xaiOk(text: string) {
    return new Response(
      JSON.stringify({ id: 'resp_1', output_text: text, usage: { input_tokens: 5, output_tokens: 2 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  it('a PINNED BYO model that fails hands off to the tenant\'s OTHER connected account', async () => {
    // The measured production stall: a cloud run pins `claude-opus-5` (its own BYO
    // model, so it legitimately leads) while xAI/OpenAI/Meta are ALSO connected. Before
    // the fix the pin was the entire BYO chain, so one bad Anthropic call ended the run
    // with `byo_unavailable` and the other accounts were never tried.
    const seen: string[] = [];
    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      seen.push(url);
      if (url === ANTHROPIC_ENDPOINT) return new Response('upstream boom', { status: 500 });
      if (url === XAI_OAUTH_ENDPOINT) return xaiOk('planned on grok');
      throw new Error(`shared pool must not be reached: ${url}`);
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await twoAccountProxy().complete({ ...request, model: 'claude-opus-5' });

    expect(result.response.status).toBe(200);
    expect(result.resolvedVendor).toBe('xai-oauth');
    expect(result.resolvedModel).toBe('xai-oauth/grok-4.5');
    // The pin still LED — failover, not reordering.
    expect(seen[0]).toBe(ANTHROPIC_ENDPOINT);
    expect(seen).toContain(XAI_OAUTH_ENDPOINT);
    // Still inside the BYO boundary: no operator-funded model was touched.
    expect(seen.some((u) => u === OPENROUTER_ENDPOINT)).toBe(false);
  });

  it('a COOLED connected model is probed rather than 503-ing while accounts are usable', async () => {
    // Every connected candidate is benched, so the chain composes empty. Failing closed
    // here is what converted a ≤90s cooldown into a permanently stalled ticket (autonomy
    // halts after 3 consecutive failures), so the owner's own account gets one probe.
    await recordFailure(env, 'anthropic', 'claude-opus-5', 500);

    const fetchSpy = vi.fn(async (input: string | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === ANTHROPIC_ENDPOINT) return anthropicOk('planned after probe');
      throw new Error(`shared pool must not be reached: ${url}`);
    });
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;

    const result = await connectedProxy().complete(request);

    expect(result.response.status).toBe(200);
    expect(result.resolvedModel).toBe('claude-opus-5');
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('configured but unresolved BYO account', () => {
  it('fails closed without contacting a BuilderForce-managed provider', async () => {
    const fetchSpy = vi.fn(async () => openaiOk('must not be used'));
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    const proxy = llmProxyForPlan(env, 'free', false, {
      codingOnly: true,
      byoRequired: true,
    });

    const result = await proxy.complete(request);

    expect(result.response.status).toBe(503);
    expect(result.outcome).toBe('byo_unavailable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // The reported complaint: with four accounts visible in the Provider-priority UI, a
  // 503 reading "no configured provider is currently usable" is indistinguishable from
  // the gateway not seeing them at all, and it named neither the providers nor a single
  // model. The envelope must carry BOTH — the providers (with the per-provider reason
  // each was unusable) and every model the chain walked.
  it('NAMES the configured providers, why each was unusable, and every model it tried', async () => {
    const fetchSpy = vi.fn(async () => openaiOk('must not be used'));
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    const proxy = llmProxyForPlan(env, 'free', false, {
      codingOnly: true,
      byoRequired: true,
      byoDiagnostics: {
        configuredProviders: ['xai', 'openai', 'anthropic', 'meta'],
        unresolvedReasons: { xai: 'revoked', openai: 'expired', anthropic: 'undecryptable', meta: 'undecryptable' },
      },
    });

    const result = await proxy.complete(request);
    const body = await result.response.clone().json() as {
      error: string;
      code: string;
      details: { attemptedModels: string[]; configuredProviders: string[]; unresolvedReasons: Record<string, string>; connectedVendors: string[] };
    };

    expect(result.response.status).toBe(503);
    expect(body.code).toBe('byo_unavailable');
    // The discriminating sentence: connected ≠ resolved. Never "no provider is connected".
    expect(body.error).toContain('4 provider(s) are connected but NONE resolved');
    // Every provider, each with WHY it was unusable — the actionable half.
    for (const [p, reason] of Object.entries({ xai: 'revoked', openai: 'expired', anthropic: 'undecryptable' })) {
      expect(body.error).toContain(`${p} (unusable: ${reason})`);
      expect(body.details.unresolvedReasons[p]).toBe(reason);
    }
    expect(body.details.configuredProviders).toEqual(['xai', 'openai', 'anthropic', 'meta']);
    expect(body.details.connectedVendors).toEqual([]);
    // The models — the operator's explicit ask. Both the prose and the structured field.
    expect(body.error).toContain('models tried:');
    expect(Array.isArray(body.details.attemptedModels)).toBe(true);
    // …and the SAME list rides `candidateChain`, so the cloud loop's ` · chain: …`
    // suffix, the superadmin trace and the tool_audit detail all agree instead of
    // reporting an empty chain.
    expect(result.candidateChain).toEqual(body.details.attemptedModels);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('says "no provider is connected" only when nothing is actually configured', async () => {
    const fetchSpy = vi.fn(async () => openaiOk('must not be used'));
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    const proxy = llmProxyForPlan(env, 'free', false, { codingOnly: true, byoRequired: true });

    const body = await (await proxy.complete(request)).response.json() as { error: string };

    expect(body.error).toContain('no provider is connected on this workspace');
    expect(body.error).not.toContain('resolved to a usable credential this request —');
  });

  it('a strict pin on an unconnected vendor names the vendor it needs and what IS usable', async () => {
    const fetchSpy = vi.fn(async () => openaiOk('must not be used'));
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    const proxy = llmProxyForPlan(env, 'free', false, {
      codingOnly: true,
      anthropicOAuthToken: 'sk-ant-oat-test-token',   // anthropic resolves…
      byoDiagnostics: { configuredProviders: ['anthropic', 'openai'], unresolvedReasons: { openai: 'revoked' } },
    });

    // …but the pin is on OpenAI, which is connected yet unusable.
    const result = await proxy.complete({ ...request, model: 'direct/openai/gpt-4.1', modelStrict: true });
    const body = await result.response.json() as { code: string; details: { requiredVendor: string; connectedVendors: string[] }; error: string };

    expect(result.response.status).toBe(503);
    expect(body.code).toBe('model_unavailable');
    expect(body.details.requiredVendor).toBe('openai');
    expect(body.details.connectedVendors).toContain('anthropic');
    expect(body.error).toContain("needs the 'openai' provider");
    expect(body.error).toContain('openai (unusable: revoked)');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
