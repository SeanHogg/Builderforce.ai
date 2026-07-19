import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicModule } from './anthropic';

// ---------------------------------------------------------------------------
// ADAPTIVE thinking must work INSIDE the cloud tool loop (Residual 4), not only on
// tool-less turns. It is valid alongside tools on the FIRST (planning) turn — no prior
// assistant/thinking turn to preserve — and must stay OFF on continuation turns (whose
// thinking block was stripped by the gateway's OpenAI round-trip, which would 400).
//
// The wire shape is `{type:'adaptive'}` + `output_config.effort`. The legacy manual
// form `{type:'enabled', budget_tokens:N}` is REMOVED on every model in this vendor's
// catalog (Sonnet 5, Opus 4.8) and returns HTTP 400, so it must never be emitted.
// ---------------------------------------------------------------------------

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

function captureBody(): { get: () => any } {
  let captured: any = null;
  const fn = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== ANTHROPIC_ENDPOINT) throw new Error(`unmocked: ${url}`);
    captured = JSON.parse(String(init?.body ?? '{}'));
    return new Response(
      JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  });
  (globalThis as { fetch: typeof fetch }).fetch = fn as unknown as typeof fetch;
  return { get: () => captured };
}

const TOOLS = [
  { type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } } },
];

describe('direct-Anthropic extended thinking in the tool loop', () => {
  it('ENABLES thinking with tools on the first turn (no prior assistant turn)', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [
        { role: 'system', content: 'coding instructions' },
        { role: 'user', content: 'Add the avatar filter.' },
      ],
      extraBody: { tools: TOOLS, thinking: { type: 'adaptive' }, thinkingEffort: 'high', firstTurn: true },
    });
    const body = cap.get();
    expect(body.thinking).toEqual({ type: 'adaptive' });
    // Depth rides on output_config.effort now — the legacy budget_tokens form is
    // REMOVED on Sonnet 5 / Opus 4.8 and 400s, so it must never be emitted.
    expect(body.output_config?.effort).toBe('high');
    expect(JSON.stringify(body)).not.toContain('budget_tokens');
  });

  it('enables thinking with tools on a first turn even WITHOUT the explicit hint (message-inspection invariant)', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'Plan the change.' }],
      extraBody: { tools: TOOLS, thinking: { type: 'adaptive' }, thinkingEffort: 'high' },
    });
    expect(cap.get().thinking).toEqual({ type: 'adaptive' });
  });

  it('DISABLES thinking with tools on a continuation turn (a prior assistant turn is present)', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [
        { role: 'user', content: 'Add the avatar filter.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: 't1', content: 'file contents' },
      ],
      // The loop threads firstTurn:false, but message-inspection alone would also veto.
      extraBody: { tools: TOOLS, thinking: { type: 'adaptive' }, thinkingEffort: 'high', firstTurn: false },
    });
    expect(cap.get().thinking).toEqual({ type: 'disabled' });
  });

  it('an explicit firstTurn:false veto keeps thinking off even on a tool turn with no assistant history', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'Plan the change.' }],
      extraBody: { tools: TOOLS, thinking: { type: 'adaptive' }, thinkingEffort: 'high', firstTurn: false },
    });
    expect(cap.get().thinking).toEqual({ type: 'disabled' });
  });

  it('still enables thinking on a tool-LESS turn (no regression)', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'Summarize.' }],
      extraBody: { thinking: { type: 'adaptive' }, thinkingEffort: 'high' },
    });
    expect(cap.get().thinking).toEqual({ type: 'adaptive' });
  });
});

// ---------------------------------------------------------------------------
// Structured-output schema sanitization. Anthropic's structured-output compiler
// rejects JSON Schema keywords it does not implement (numeric/length/array
// constraints) with a 400 — sinking the whole request. Callers speak generic JSON
// Schema, so the translator must strip them. Regression: the Studio shot-planner
// schema carries `{type:'integer', minimum: 1}`, which 400'd every cinematic
// storyboard plan and surfaced as "AI vendor cascade exhausted".
// ---------------------------------------------------------------------------

describe('direct-Anthropic structured-output schema sanitization', () => {
  const SHOT_PLANNER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['shots'],
    properties: {
      shots: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['prompt', 'durationFrames'],
          properties: {
            prompt: { type: 'string', minLength: 3 },
            durationFrames: { type: 'integer', minimum: 1 },
          },
        },
      },
    },
  };

  it('strips unsupported keywords from output_config.format.schema', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'Plan the shots.' }],
      extraBody: {
        response_format: { type: 'json_schema', json_schema: { name: 'shot_planner', schema: SHOT_PLANNER_SCHEMA, strict: true } },
      },
    });
    const schema = cap.get().output_config.format.schema;
    const serialized = JSON.stringify(schema);
    for (const banned of ['minimum', 'minItems', 'minLength']) {
      expect(serialized).not.toContain(banned);
    }
    // The structure the model must return is preserved — only constraints are dropped.
    expect(schema.properties.shots.items.properties.durationFrames.type).toBe('integer');
    expect(schema.required).toEqual(['shots']);
    expect(schema.additionalProperties).toBe(false);
  });

  it('leaves the caller schema object unmutated (it may be a shared constant)', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5',
      messages: [{ role: 'user', content: 'Plan the shots.' }],
      extraBody: {
        response_format: { type: 'json_schema', json_schema: { name: 'shot_planner', schema: SHOT_PLANNER_SCHEMA, strict: true } },
      },
    });
    expect(cap.get().output_config.format.schema).toBeDefined();
    expect((SHOT_PLANNER_SCHEMA.properties.shots.items.properties.durationFrames as any).minimum).toBe(1);
  });
});
