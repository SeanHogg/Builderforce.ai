import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicModule, VOLATILE_TAIL_TAG } from '../../llm/vendors/anthropic';
import { turnRequestMessages } from './volatileTail';

// ---------------------------------------------------------------------------
// Cost lever B1: two consecutive turns of a tool loop must send byte-identical bytes
// up to the last cache breakpoint of the earlier turn — so the later turn reads the
// whole prefix from the cache — even though the affect block and budget line change
// every turn. Exercised end to end through the direct Anthropic request builder.
// ---------------------------------------------------------------------------

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

type Body = { tools: Array<Record<string, unknown>>; system: Array<Record<string, unknown>>; messages: Array<{ role: string; content: Array<Record<string, unknown>> }> };

async function requestBody(messages: Array<Record<string, unknown>>, cacheTtl?: '1h'): Promise<Body> {
  let captured: Body | null = null;
  (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    if (String(input) !== ENDPOINT) throw new Error(`unmocked: ${String(input)}`);
    captured = JSON.parse(String(init?.body ?? '{}')) as Body;
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
  }) as unknown as typeof fetch;
  await anthropicModule.call({
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-5',
    messages: messages as never,
    extraBody: { tools: [{ type: 'function', function: { name: 'read_file', description: 'read', parameters: { type: 'object', properties: {} } } }] },
    ...(cacheTtl ? { cacheTtl } : {}),
  });
  return captured!;
}

/** Every cacheable unit in prefix order, with its breakpoint marker stripped. */
function units(body: Body): { key: string; marked: boolean }[] {
  const strip = (b: Record<string, unknown>) => { const { cache_control: _c, ...rest } = b; return JSON.stringify(rest); };
  return [
    ...body.tools.map((t) => ({ key: `tool:${strip(t)}`, marked: 'cache_control' in t })),
    ...body.system.map((b) => ({ key: `system:${strip(b)}`, marked: 'cache_control' in b })),
    ...body.messages.flatMap((m, i) => m.content.map((b) => ({ key: `${i}:${m.role}:${strip(b)}`, marked: 'cache_control' in b }))),
  ];
}

const call = (id: string) => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name: 'read_file', arguments: `{"path":"${id}.ts"}` } }] });
const result = (id: string) => ({ role: 'tool', tool_call_id: id, content: `{"ok":true,"content":"file ${id}"}` });
const SYSTEM = { role: 'system', content: 'Large stable coding instructions + repo context.' };
const BRIEF = { role: 'user', content: 'Add the avatar filter.' };
const turnN = [SYSTEM, BRIEF, call('c1'), result('c1')];
const turnN1 = [...turnN, call('c2'), result('c2')];

describe('B1 stable prefix', () => {
  it('two consecutive turns share every byte up to the earlier turn\'s last breakpoint', async () => {
    const a = units(await requestBody(turnRequestMessages(turnN, { stablePrefix: true, dynamicSystem: 'Affect: calm.', sections: ['Budget left: ~$4.00, ~180000 tokens.'] })));
    const b = units(await requestBody(turnRequestMessages(turnN1, { stablePrefix: true, dynamicSystem: 'Affect: cautious.', sections: ['Budget left: ~$3.10, ~150000 tokens.'] })));
    const lastBreakpoint = a.map((u) => u.marked).lastIndexOf(true);
    expect(lastBreakpoint).toBeGreaterThan(0);
    expect(b.slice(0, lastBreakpoint + 1).map((u) => u.key)).toEqual(a.slice(0, lastBreakpoint + 1).map((u) => u.key));
    // The breakpoint sits on the last HISTORY block; the volatile tail trails it, unmarked.
    expect(a[lastBreakpoint]!.key).toContain('tool_result');
    expect(a[a.length - 1]!.key).toContain(VOLATILE_TAIL_TAG);
    expect(a[a.length - 1]!.marked).toBe(false);
  });

  it('lever off: the prepended affect system block changes the cached system prefix', async () => {
    const a = units(await requestBody(turnRequestMessages(turnN, { stablePrefix: false, dynamicSystem: 'Affect: calm.', sections: [] })));
    const b = units(await requestBody(turnRequestMessages(turnN1, { stablePrefix: false, dynamicSystem: 'Affect: cautious.', sections: [] })));
    const firstSystem = a.findIndex((u) => u.key.startsWith('system:'));
    expect(b[firstSystem]!.key).not.toBe(a[firstSystem]!.key);
  });

  it('adds no tail at all when there is nothing volatile', () => {
    expect(turnRequestMessages(turnN, { stablePrefix: true, sections: ['', '  '] })).toEqual(turnN);
  });

  it('honours a 1h cacheTtl on every breakpoint', async () => {
    const body = await requestBody(turnN, '1h');
    const markers = JSON.stringify(body).match(/"cache_control":\{[^}]*\}/g) ?? [];
    expect(markers.length).toBeGreaterThan(0);
    for (const m of markers) expect(m).toContain('"ttl":"1h"');
  });
});
