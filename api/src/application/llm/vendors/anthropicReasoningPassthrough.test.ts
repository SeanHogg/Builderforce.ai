import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicModule } from './anthropic';
import { splitReasoning } from '../reasoningContent';

/**
 * GAP B1 — the direct-Anthropic normaliser used to keep only `text` and
 * `tool_use` blocks, so extended-thinking output never reached a timeline. It now
 * rides on the OpenAI-shape message as `reasoning_content`, the field every loop
 * reads through `splitReasoning`.
 */
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

function respondWith(content: unknown[]): void {
  (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url !== ENDPOINT) throw new Error(`unmocked: ${url}`);
    return new Response(JSON.stringify({ id: 'msg', content, stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 4 } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

type Choice = { choices: Array<{ message: Record<string, unknown> }> };

describe('direct-Anthropic thinking blocks reach the chat-completion message', () => {
  it('joins thinking blocks into reasoning_content and keeps the visible text clean', async () => {
    respondWith([
      { type: 'thinking', thinking: 'The failing test names the helper.', signature: 'sig' },
      { type: 'redacted_thinking', data: 'opaque' },
      { type: 'text', text: 'Renaming the helper.' },
    ]);
    const r = await anthropicModule.call({ apiKey: 'sk-ant-test', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'fix it' }] });
    const message = (r.raw as Choice).choices[0].message;
    expect(message.content).toBe('Renaming the helper.');
    expect(message.reasoning_content).toBe('The failing test names the helper.');
    expect(splitReasoning(message)).toEqual({ content: 'Renaming the helper.', reasoning: 'The failing test names the helper.' });
  });

  it('omits reasoning_content when the turn carried no thinking block', async () => {
    respondWith([{ type: 'text', text: 'ok' }]);
    const r = await anthropicModule.call({ apiKey: 'sk-ant-test', model: 'claude-opus-4-8', messages: [{ role: 'user', content: 'hi' }] });
    const message = (r.raw as Choice).choices[0].message;
    expect('reasoning_content' in message).toBe(false);
  });
});
