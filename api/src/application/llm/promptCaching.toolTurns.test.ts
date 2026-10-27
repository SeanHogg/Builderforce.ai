import { afterEach, describe, expect, it, vi } from 'vitest';
import { VOLATILE_TAIL_TAG } from '@seanhogg/builderforce-memory/handoff';
import { applyPromptCaching, lastStableIndex } from './promptCaching';
import { anthropicModule } from './vendors/anthropic';

// ---------------------------------------------------------------------------
// WS-C: the history breakpoint lands on the last STABLE message, tool turns included,
// on BOTH placers (OpenRouter over OpenAI-format messages, the direct Anthropic vendor
// over native blocks) — and never on the trailing `<run-state>` tail.
// ---------------------------------------------------------------------------

const EPHEMERAL = { type: 'ephemeral' };
const TAIL = `${VOLATILE_TAIL_TAG}\nbudget: 40%\n</run-state>`;
const call = (id: string) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: '{}' } }] });
const result = (id: string) => ({ role: 'tool', tool_call_id: id, content: `file ${id}` });

describe('lastStableIndex — the one rule both placers share', () => {
  it('walks back past volatile and unmarkable items, never at or below the floor', () => {
    const items = ['a', 'B', 'x', 'v', 'v'];
    const isVolatile = (s: string) => s === 'v';
    const canMark = (s: string) => s !== 'x';
    expect(lastStableIndex(items, isVolatile, canMark)).toBe(1);
    expect(lastStableIndex(items, isVolatile, canMark, 1)).toBe(-1);
    expect(lastStableIndex([], isVolatile, canMark)).toBe(-1);
  });
});

describe('OpenRouter placer — tool loops cache their history', () => {
  it('marks the LAST tool result (promoted to a text part), not the last text turn', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      call('c1'),
      result('c1'),
      call('c2'),
      result('c2'),
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[5]!.content).toEqual([{ type: 'text', text: 'file c2', cache_control: EPHEMERAL }]);
    expect((out[5] as { tool_call_id?: string }).tool_call_id).toBe('c2');
    // The system prompt, the newest stable message, and — as a fallback in case a
    // provider drops a tool-role marker — the last stable TEXT turn before it.
    expect(out[1]!.content).toEqual([{ type: 'text', text: 'q', cache_control: EPHEMERAL }]);
    expect(out[3]).toBe(messages[3]);
  });

  it('marks the tool result BEFORE the trailing <run-state> tail, never the tail', () => {
    const messages = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'q' },
      call('c1'),
      result('c1'),
      { role: 'user', content: TAIL },
    ];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[4]).toBe(messages[4]);
    expect(out[3]!.content).toEqual([{ type: 'text', text: 'file c1', cache_control: EPHEMERAL }]);
  });

  it('walks past a text-less assistant tool-call turn (nothing to attach to)', () => {
    const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'q' }, call('c1')];
    const out = applyPromptCaching(messages, 'anthropic/claude-sonnet-5');
    expect(out[2]).toBe(messages[2]);
    expect(out[1]!.content).toEqual([{ type: 'text', text: 'q', cache_control: EPHEMERAL }]);
  });

  it('moves the breakpoint forward with the loop: each turn marks its own newest tool result', () => {
    const turnN = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'q' }, call('c1'), result('c1')];
    const turnN1 = [...turnN, call('c2'), result('c2')];
    const marked = (out: Array<Record<string, unknown>>) => out.flatMap((m, i) => (JSON.stringify(m).includes('cache_control') ? [i] : []));
    // Index 1 is the fallback text breakpoint (stable across turns); the tool mark moves.
    expect(marked(applyPromptCaching(turnN, 'anthropic/claude-sonnet-5'))).toEqual([0, 1, 3]);
    expect(marked(applyPromptCaching(turnN1, 'anthropic/claude-sonnet-5'))).toEqual([0, 1, 5]);
  });
});

describe('direct Anthropic placer — same rule over native blocks', () => {
  const ENDPOINT = 'https://api.anthropic.com/v1/messages';
  const originalFetch = globalThis.fetch;
  afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

  async function body(messages: Array<Record<string, unknown>>): Promise<{ messages: Array<{ role: string; content: Array<Record<string, unknown>> }> }> {
    let captured: unknown = null;
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
      if (String(input) !== ENDPOINT) throw new Error(`unmocked: ${String(input)}`);
      captured = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    }) as unknown as typeof fetch;
    await anthropicModule.call({ apiKey: 'sk-ant-test', model: 'claude-sonnet-5', messages: messages as never });
    return captured as never;
  }

  it('marks the last tool_result and leaves the merged <run-state> block after it unmarked', async () => {
    const out = await body([{ role: 'user', content: 'q' }, call('c1'), result('c1'), { role: 'user', content: TAIL }]);
    const last = out.messages[out.messages.length - 1]!;
    expect(last.content.map((b) => b.type)).toEqual(['tool_result', 'text']);
    expect(last.content[0]!.cache_control).toEqual(EPHEMERAL);
    expect(last.content[1]).not.toHaveProperty('cache_control');
  });

  it('marks the previous message when the last one is the tail alone', async () => {
    const out = await body([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }, { role: 'user', content: TAIL }]);
    expect(out.messages[1]!.content[0]!.cache_control).toEqual(EPHEMERAL);
    expect(out.messages[2]!.content[0]).not.toHaveProperty('cache_control');
  });
});
