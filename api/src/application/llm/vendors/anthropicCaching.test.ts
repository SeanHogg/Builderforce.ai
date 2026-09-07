import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicModule } from './anthropic';

// ---------------------------------------------------------------------------
// The direct-Anthropic floor is the METERED path (operator's CLAUDE_API_KEY). A
// multi-turn coding run re-sends a large stable prefix (system instructions/repo
// context + tool defs) every turn — without `cache_control` that pays full price
// each time. The vendor must mark the system block and the last tool so the prefix
// caches at the ~0.1x read rate.
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

describe('direct-Anthropic prompt caching', () => {
  it('marks the system block and the last tool with cache_control', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5',
      messages: [
        { role: 'system', content: 'Large stable coding instructions + repo context.' },
        { role: 'user', content: 'Add the avatar filter.' },
      ],
      extraBody: {
        tools: [
          { type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } } },
          { type: 'function', function: { name: 'write_file', description: 'write', parameters: { type: 'object', properties: {} } } },
        ],
      },
    });

    const body = cap.get();
    // system is sent as a block array carrying cache_control.
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[body.system.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    // the LAST tool carries cache_control (caches the whole tools prefix); earlier ones don't.
    expect(body.tools[body.tools.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.tools[0].cache_control).toBeUndefined();
  });

  it('marks the latest turn too, so a tool loop reads its growing transcript from the cache', async () => {
    const cap = captureBody();
    await anthropicModule.call({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5',
      messages: [
        { role: 'system', content: 'Large stable coding instructions + repo context.' },
        { role: 'user', content: 'Add the avatar filter.' },
        { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }] },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true,"content":"..."}' },
      ],
      extraBody: {
        tools: [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } } }],
      },
    });
    const body = cap.get();
    const last = body.messages[body.messages.length - 1];
    const lastBlock = last.content[last.content.length - 1];
    expect(lastBlock.type).toBe('tool_result');
    expect(lastBlock.cache_control).toEqual({ type: 'ephemeral' });
    // Three breakpoints in all — tools, system, latest turn — inside Anthropic's cap of four.
    const count = JSON.stringify(body).split('"cache_control"').length - 1;
    expect(count).toBe(3);
    // Earlier turns carry none.
    expect(JSON.stringify(body.messages.slice(0, -1))).not.toContain('cache_control');
  });
});
