import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicModule } from './anthropic';

// ---------------------------------------------------------------------------
// Extended thinking must work INSIDE the cloud tool loop (Residual 4), not only on
// tool-less turns. It is valid alongside tools on the FIRST (planning) turn — no prior
// assistant/thinking turn to preserve — and must stay OFF on continuation turns (whose
// thinking block was stripped by the gateway's OpenAI round-trip, which would 400).
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
      extraBody: { tools: TOOLS, thinking: { type: 'enabled', budget_tokens: 8192 }, firstTurn: true },
    });
    const body = cap.get();
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
    // max_tokens is bumped above the budget so Anthropic accepts it.
    expect(body.max_tokens).toBeGreaterThan(8192);
  });

  it('enables thinking with tools on a first turn even WITHOUT the explicit hint (message-inspection invariant)', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'Plan the change.' }],
      extraBody: { tools: TOOLS, thinking: { type: 'enabled', budget_tokens: 8192 } },
    });
    expect(cap.get().thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
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
      extraBody: { tools: TOOLS, thinking: { type: 'enabled', budget_tokens: 8192 }, firstTurn: false },
    });
    expect(cap.get().thinking).toEqual({ type: 'disabled' });
  });

  it('an explicit firstTurn:false veto keeps thinking off even on a tool turn with no assistant history', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'Plan the change.' }],
      extraBody: { tools: TOOLS, thinking: { type: 'enabled', budget_tokens: 8192 }, firstTurn: false },
    });
    expect(cap.get().thinking).toEqual({ type: 'disabled' });
  });

  it('still enables thinking on a tool-LESS turn (no regression)', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'Summarize.' }],
      extraBody: { thinking: { type: 'enabled', budget_tokens: 8192 } },
    });
    expect(cap.get().thinking).toEqual({ type: 'enabled', budget_tokens: 8192 });
  });
});
