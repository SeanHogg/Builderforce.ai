import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { llmProxyForPlan, downgradeResponseFormat, type ProxyEnv } from './LlmProxyService';
import { isSchemaComplexityBody } from './vendors';
import { _resetMemoryCooldowns } from '../../infrastructure/auth/cooldownStore';

// ---------------------------------------------------------------------------
// Schema-too-complex handling — the hired.video resume-tailor guarantee.
//
// Before: a Gemini "too many states for serving" rejection arrived as a 200 with
// an embedded error (code: 0), so the cascade burned every candidate and the
// gateway collapsed it into a misleading `429 cascade_exhausted`.
//
// After: the transport classifies it as `kind: 'schema'` (carrying the real
// upstream status). When EVERY candidate rejects the json_schema, the gateway
// AUTO-DOWNGRADES the request to loose `json_object` (no constrained-decoding
// ceiling) and re-runs the cascade — so a structured result still comes back
// instead of a hard failure. Only when even json_object can't be served does it
// surface an honest non-200.
// ---------------------------------------------------------------------------

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

const GEMINI_SCHEMA_MSG =
  'Unable to submit request because it has too many states for serving. ' +
  'Please reduce the complexity of your response schema.';

const originalFetch = globalThis.fetch;
// The in-memory cooldown store is module-global, so a 429 in one test would cool
// a model for the next — reset it per test so each scenario starts clean.
beforeEach(() => { _resetMemoryCooldowns(); });
afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
});

const env: ProxyEnv = { OPENROUTER_API_KEY: 'or-free', OPENROUTER_API_KEY_PRO: 'or-pro' };

const schemaBody = {
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'X', strict: true, schema: { type: 'object', properties: { a: { type: 'string' } } } },
  },
  messages: [{ role: 'user' as const, content: 'extract' }],
};

describe('schema rejection classification (observed on the recovery path)', () => {
  for (const surface of ['embedded200', 'fatal400'] as const) {
    it(`classifies every schema rejection with kind/reason/upstreamStatus (${surface})`, async () => {
      // json_schema rejected on every model (this surface); json_object answers,
      // so the request still succeeds — and the spliced failover trace carries the
      // structured schema-rejection rows for observability.
      const expectedUpstream = surface === 'embedded200' ? 200 : 400;
      const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
        const parsed = JSON.parse(String(init?.body ?? '{}')) as { response_format?: { type?: string } };
        if (parsed.response_format?.type === 'json_schema') {
          return new Response(JSON.stringify({ error: { message: GEMINI_SCHEMA_MSG } }), {
            status: surface === 'embedded200' ? 200 : 400, headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: '{"summary":"ok"}' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      });
      (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

      const result = await llmProxyForPlan(env, 'free').complete(schemaBody);

      expect(result.response.status).toBe(200);
      expect(result.schemaDowngraded).toBe(true);
      const schemaRows = result.failovers.filter((f) => f.kind === 'schema');
      expect(schemaRows.length).toBeGreaterThan(0);
      expect(schemaRows.every((f) => f.reason === 'schema_too_complex')).toBe(true);
      expect(schemaRows.every((f) => f.upstreamStatus === expectedUpstream)).toBe(true);
      // Normalized to the 422 request-error class on the wire `code`.
      expect(schemaRows.every((f) => f.code === 422)).toBe(true);
    });
  }

  it('surfaces a terminal 422 schema_too_complex only when there is NO json_schema to relax', () => {
    // The downgrade helper is the single guard: a body without a strict json_schema
    // can't be relaxed, so the gateway surfaces the terminal error honestly. (For a
    // real json_schema, the auto-downgrade always attempts json_object first.)
    expect(downgradeResponseFormat({ messages: [{ role: 'user', content: 'x' }] })).toBeNull();
    expect(downgradeResponseFormat({ messages: [], response_format: { type: 'json_object' } } as never)).toBeNull();
  });
});

describe('schema auto-downgrade — honest failure floor', () => {
  it('still surfaces a non-200 when EVEN json_object cannot be served (total saturation, no credited key)', async () => {
    // json_schema rejected; json_object 429s on every model; only the free key is
    // bound so the funded backstop has nothing extra to try. The gateway tried the
    // full recovery (schema → downgrade → backstop) and honestly reports the
    // saturation — it never silently claims success.
    const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { response_format?: { type?: string } };
      if (parsed.response_format?.type === 'json_schema') {
        return new Response(JSON.stringify({ error: { message: GEMINI_SCHEMA_MSG } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429, headers: { 'content-type': 'application/json' },
      });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

    const result = await llmProxyForPlan({ OPENROUTER_API_KEY: 'or-free' }, 'free').complete(schemaBody);

    expect(result.response.status).toBeGreaterThanOrEqual(400);
    expect(result.response.status).not.toBe(200);
    // The downgrade WAS attempted (so consumers see we exhausted recovery).
    expect(result.schemaDowngraded).toBe(true);
  });
});

describe('schema auto-downgrade — always produce a result', () => {
  it('downgrades a too-complex json_schema to json_object and returns a 200 with content', async () => {
    // Every model rejects the STRICT json_schema; the same model answers once the
    // gateway relaxes the request to json_object (no constrained-decoding ceiling).
    // This is the hired.video resume-tailor guarantee: a structured result comes
    // back instead of a terminal schema error.
    const calls: Array<{ rfType: string; content: string }> = [];
    const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url !== OPENROUTER_ENDPOINT) throw new Error(`unmocked fetch: ${url}`);
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { response_format?: { type?: string } };
      const rfType = parsed.response_format?.type ?? 'none';
      calls.push({ rfType, content: String(init?.body ?? '') });
      if (rfType === 'json_schema') {
        // Strict schema → rejected as too complex (200-embedded, the Gemini shape).
        return new Response(JSON.stringify({ error: { message: GEMINI_SCHEMA_MSG } }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      // Loose json_object → the model answers with the tailored result.
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '{"summary":"tailored resume"}' } }],
        usage: { prompt_tokens: 50, completion_tokens: 120, total_tokens: 170 },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;

    const proxy = llmProxyForPlan(env, 'free');
    const result = await proxy.complete(schemaBody);

    // The feature gets a 200 with the tailored result — NOT a terminal 422.
    expect(result.response.status).toBe(200);
    expect(result.outcome).toBe('success');
    expect(result.schemaDowngraded).toBe(true);

    const payload = await result.response.json() as { choices?: Array<{ message?: { content?: string } }> };
    expect(payload.choices?.[0]?.message?.content).toContain('tailored resume');

    // Proof the recovery path ran: at least one json_schema attempt (rejected) and
    // then a json_object attempt (answered).
    expect(calls.some((c) => c.rfType === 'json_schema')).toBe(true);
    expect(calls.some((c) => c.rfType === 'json_object')).toBe(true);
    // The relaxed request carries the schema into the prompt as guidance.
    const downgradedCall = calls.find((c) => c.rfType === 'json_object');
    expect(downgradedCall?.content).toContain('conforms to this JSON Schema');
  });
});

describe('isSchemaComplexityBody', () => {
  it('matches vendor schema-complexity rejections', () => {
    expect(isSchemaComplexityBody('too many states for serving; reduce schema complexity')).toBe(true);
    expect(isSchemaComplexityBody('Your response_format.json_schema is too complex')).toBe(true);
    expect(isSchemaComplexityBody('schema exceeds the maximum number of enum values')).toBe(true);
    expect(isSchemaComplexityBody('json_schema is too deeply nested')).toBe(true);
  });

  it('does NOT match generic malformed-request or unrelated errors (no false positives)', () => {
    expect(isSchemaComplexityBody('invalid request: missing field "messages"')).toBe(false);
    expect(isSchemaComplexityBody('rate limited, try again later')).toBe(false);
    expect(isSchemaComplexityBody('too many requests')).toBe(false); // "too many" but not schema-related
    expect(isSchemaComplexityBody('')).toBe(false);
    expect(isSchemaComplexityBody(null)).toBe(false);
  });
});
