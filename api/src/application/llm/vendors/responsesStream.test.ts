import { afterEach, describe, expect, it, vi } from 'vitest';
import { peekResponsesStreamError, responsesSseToChatSse } from './responsesStream';
import { openAiCodexModule } from './openaiCodex';
import { xaiOAuthModule } from './xaiOAuth';
import { reasoningReplayKey, type ReasoningChain, type ReasoningReplayStore } from './reasoningReplay';
import { VendorRetryableError } from './types';
import type { VendorCallParams } from './types';

/** Build a ReadableStream that emits each string as its own chunk, so the test can
 *  assert that a delta is FORWARDED before the upstream has finished. */
function sseStream(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= parts.length) { controller.close(); return; }
      controller.enqueue(encoder.encode(parts[i]!));
      i += 1;
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

/** Parse the emitted SSE back into chunk objects (dropping `[DONE]`). */
function chunks(sse: string): Array<any> {
  return sse.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim()).filter((d) => d && d !== '[DONE]')
    .map((d) => JSON.parse(d) as Record<string, any>);
}

const baseParams: VendorCallParams = {
  apiKey: JSON.stringify({ accessToken: 'tok', accountId: 'acct' }),
  model: 'gpt-5.6-sol',
  messages: [{ role: 'user', content: 'hi' }],
} as unknown as VendorCallParams;

describe('xAI doom-loop check (response.doom_loop_check)', () => {
  it('ends the stream as a failure on a confident loop in the reasoning, and stops reading', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"Working"}\n\n',
      'event: response.doom_loop_check\ndata: {"sequence_number":4176,"type":"response.doom_loop_check","doom_loop_check":{"triggers":["tail_repetition:8@thinking"]}}\n\n',
      'data: {"type":"response.output_text.delta","delta":" 0 1 2 3"}\n\n',
    ]), { model: 'grok-4.6' }));

    const parsed = chunks(out);
    expect(parsed.at(-1)?.error?.message).toContain('tail_repetition:8@thinking');
    expect(out).not.toContain('0 1 2 3');
    expect(out.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('ends a loop in the visible reply too — chat #105\'s ever-growing tool name', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"tasks.events_triggers_runs_logs_tail_stats_reset_all_reset_all,"}\n\n',
      'data: {"type":"response.doom_loop_check","doom_loop_check":{"triggers":["tail_repetition:4@response"]}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"_reset_all_reset_all"}\n\n',
    ]), { model: 'grok-4.6' }));

    expect(chunks(out).at(-1)?.error?.message).toContain('tail_repetition:4@response');
    expect(out).not.toContain('_reset_all_reset_all"');
  });

  it('treats low-logprob and unknown triggers as warnings only', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"ok"}\n\n',
      'data: {"type":"response.doom_loop_check","doom_loop_check":{"triggers":["low_logprob@thinking","exact_repetition:42x3@response","something_new@thinking"]}}\n\n',
      'data: {"type":"response.completed","response":{"id":"r1"}}\n\n',
    ]), { model: 'grok-4.6' }));

    const parsed = chunks(out);
    expect(parsed.some((c) => c.error)).toBe(false);
    expect(parsed.at(-1)?.choices?.[0]?.finish_reason).toBe('stop');
  });
});

/** A turn that reasoned, then called one tool — the frames xAI streams for it. */
const REASONED_CALL_TURN = [
  'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"reasoning","id":"rs_1","summary":[],"encrypted_content":"enc-1"}}\n\n',
  'data: {"type":"response.output_item.done","output_index":1,"item":{"type":"function_call","call_id":"call_1","name":"read_file","arguments":"{}"}}\n\n',
  'data: {"type":"response.completed","response":{"id":"r1"}}\n\n',
];
const REASONING_1 = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'enc-1' };

describe('turn items for the reasoning replay (onTurnComplete)', () => {
  it('hands the completed turn\'s reasoning and calls over, in output order, before the stream ends', async () => {
    const seen: unknown[] = [];
    const out = await drain(responsesSseToChatSse(sseStream(REASONED_CALL_TURN), {
      model: 'grok-4.6',
      onTurnComplete: async (items) => { seen.push(...items); },
    }));
    expect(seen.map((item) => (item as { type: string }).type)).toEqual(['reasoning', 'function_call']);
    expect(chunks(out).some((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.id === 'call_1')).toBe(true);
  });

  it('prefers the terminal output list when the completed frame carries one', async () => {
    const seen: unknown[] = [];
    await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.completed","response":{"id":"r1","output":[{"type":"reasoning","id":"rs_9"},{"type":"function_call","call_id":"call_9"}]}}\n\n',
    ]), { model: 'grok-4.6', onTurnComplete: async (items) => { seen.push(...items); } }));
    expect(seen).toEqual([{ type: 'reasoning', id: 'rs_9' }, { type: 'function_call', call_id: 'call_9' }]);
  });

  it('never reports a turn that failed or was cut off', async () => {
    const onTurnComplete = vi.fn(async () => undefined);
    await drain(responsesSseToChatSse(sseStream([REASONED_CALL_TURN[0]!, 'data: {"type":"response.failed","response":{"error":{"message":"x"}}}\n\n']), { model: 'grok-4.6', onTurnComplete }));
    await drain(responsesSseToChatSse(sseStream([REASONED_CALL_TURN[0]!, 'data: {"type":"response.incomplete","response":{"id":"r"}}\n\n']), { model: 'grok-4.6', onTurnComplete }));
    expect(onTurnComplete).not.toHaveBeenCalled();
  });
});

describe('xai-oauth carries Grok\'s reasoning across tool calls', () => {
  afterEach(() => vi.restoreAllMocks());

  const memoryStore = (): ReasoningReplayStore & { rows: Map<string, ReasoningChain> } => {
    const rows = new Map<string, ReasoningChain>();
    return { rows, load: async (key) => rows.get(key) ?? null, save: async (key, chain) => { rows.set(key, chain); } };
  };
  const streamed = (parts: string[]) => new Response(sseStream(parts), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  const sentBody = (fetchMock: ReturnType<typeof vi.fn>, n = 0) =>
    JSON.parse(String((fetchMock.mock.calls[n] as unknown as [string, RequestInit])[1].body));
  const TOOL_LOOP_MESSAGES = [
    { role: 'user', content: 'fix it' },
    { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'file text' },
  ];

  it('asks for encrypted reasoning, opts into the loop check, and saves the turn under its first call', async () => {
    const store = memoryStore();
    const fetchMock = vi.fn(async () => streamed(REASONED_CALL_TURN));
    vi.stubGlobal('fetch', fetchMock);

    const result = await xaiOAuthModule.callStream!({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.6', reasoningReplay: store });
    await result.response.text();

    const sent = sentBody(fetchMock);
    expect(sent.include).toEqual(['reasoning.encrypted_content']);
    expect(sent.store).toBe(false);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ 'x-grok-doom-loop-check': '1024' });
    expect(store.rows.get(await reasoningReplayKey('xai-key', 'call_1'))).toEqual({ call_1: [REASONING_1] });
  });

  it('puts the saved reasoning back immediately before its call on the next turn', async () => {
    const store = memoryStore();
    store.rows.set(await reasoningReplayKey('xai-key', 'call_1'), { call_1: [REASONING_1] });
    const fetchMock = vi.fn(async () => streamed(['data: {"type":"response.completed","response":{"id":"r2"}}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const result = await xaiOAuthModule.callStream!({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.6', messages: TOOL_LOOP_MESSAGES, reasoningReplay: store });
    await result.response.text();

    const input = sentBody(fetchMock).input as Array<{ type?: string; role?: string }>;
    expect(input.map((item) => item.type ?? item.role)).toEqual(['user', 'reasoning', 'function_call', 'function_call_output']);
    expect(input[1]).toEqual(REASONING_1);
  });

  it('never replays one credential\'s reasoning into another\'s request', async () => {
    const store = memoryStore();
    store.rows.set(await reasoningReplayKey('someone-else', 'call_1'), { call_1: [REASONING_1] });
    const fetchMock = vi.fn(async () => streamed(['data: {"type":"response.completed","response":{"id":"r2"}}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    await (await xaiOAuthModule.callStream!({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.6', messages: TOOL_LOOP_MESSAGES, reasoningReplay: store })).response.text();
    expect((sentBody(fetchMock).input as Array<{ type?: string }>).some((item) => item.type === 'reasoning')).toBe(false);
  });

  it('sends the turn once more without the replay when xAI refuses it', async () => {
    const store = memoryStore();
    store.rows.set(await reasoningReplayKey('xai-key', 'call_1'), { call_1: [REASONING_1] });
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const replayed = (JSON.parse(init.body as string).input as Array<{ type?: string }>).some((item) => item.type === 'reasoning');
      return replayed
        ? new Response('{"error":"invalid reasoning item"}', { status: 400 })
        : streamed(['data: {"type":"response.output_text.delta","delta":"ok"}\n\n', 'data: {"type":"response.completed","response":{"id":"r2"}}\n\n']);
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await xaiOAuthModule.callStream!({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.6', messages: TOOL_LOOP_MESSAGES, reasoningReplay: store });
    expect(chunks(await result.response.text())[0]!.choices[0].delta.content).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('finds Grok\'s chain behind the coder\'s turns when the run handed off and Grok is called again', async () => {
    const store = memoryStore();
    store.rows.set(await reasoningReplayKey('xai-key', 'call_1'), { call_1: [REASONING_1] });
    const fetchMock = vi.fn(async () => streamed(['data: {"type":"response.completed","response":{"id":"r3"}}\n\n']));
    vi.stubGlobal('fetch', fetchMock);

    const handedOff = [
      ...TOOL_LOOP_MESSAGES,
      // Two turns by the coding model — their call ids were never saved for Grok.
      { role: 'assistant', content: null, tool_calls: [{ id: 'qwen_1', type: 'function', function: { name: 'edit_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'qwen_1', content: 'ok' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'qwen_2', type: 'function', function: { name: 'edit_file', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'qwen_2', content: 'ok' },
    ];
    await (await xaiOAuthModule.callStream!({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.6', messages: handedOff, reasoningReplay: store })).response.text();

    const input = sentBody(fetchMock).input as Array<{ type?: string; call_id?: string; id?: string }>;
    const reasoningAt = input.findIndex((item) => item.type === 'reasoning');
    expect(input[reasoningAt]).toEqual(REASONING_1);
    expect(input[reasoningAt + 1]).toMatchObject({ type: 'function_call', call_id: 'call_1' });
  });

  it('saves the chain from a buffered answer too', async () => {
    const store = memoryStore();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'r', output: [REASONING_1, { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{}' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })));

    await xaiOAuthModule.call({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.6', reasoningReplay: store });
    expect(store.rows.get(await reasoningReplayKey('xai-key', 'call_1'))).toEqual({ call_1: [REASONING_1] });
  });
});

describe('Responses SSE → OpenAI chat SSE passthrough', () => {
  afterEach(() => vi.restoreAllMocks());

  it('forwards each text delta as its own chunk instead of buffering the generation', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.created","response":{"id":"resp_1"}}\n\n',
      'data: {"type":"response.output_text.delta","delta":"Hel"}\n\n',
      'data: {"type":"response.output_text.delta","delta":"lo"}\n\n',
      'data: {"type":"response.completed","response":{"id":"resp_1","usage":{"input_tokens":11,"output_tokens":2,"total_tokens":13}}}\n\n',
    ]), { model: 'gpt-5.6-sol' }));

    const parsed = chunks(out);
    const deltas = parsed.filter((c) => c.choices?.[0]?.delta?.content).map((c) => c.choices[0].delta.content);
    expect(deltas).toEqual(['Hel', 'lo']);
    // The first delta carries the role; the rest do not restate it.
    expect(parsed[0]!.choices[0].delta.role).toBe('assistant');
    expect(parsed[1]!.choices[0].delta.role).toBeUndefined();
    // Response id and model ride every chunk (the client's provenance fallback).
    expect(parsed.every((c) => c.id === 'resp_1' && c.model === 'gpt-5.6-sol')).toBe(true);
    // finish_reason chunk, then a usage-only chunk, mirroring include_usage.
    expect(parsed.at(-2)?.choices?.[0]?.finish_reason).toBe('stop');
    expect(parsed.at(-1)).toMatchObject({ choices: [], usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 } });
    expect(out.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('emits the first delta before the upstream has finished generating', async () => {
    const encoder = new TextEncoder();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const upstream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"response.output_text.delta","delta":"first"}\n\n'));
        await gate;
        controller.enqueue(encoder.encode('data: {"type":"response.completed","response":{"id":"r"}}\n\n'));
        controller.close();
      },
    });

    const reader = responsesSseToChatSse(upstream, { model: 'grok-4.5' }).getReader();
    const { value } = await reader.read();
    expect(new TextDecoder().decode(value)).toContain('"content":"first"');
    release();
    await reader.cancel();
  });

  it('streams a tool call as incremental argument deltas', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"call_a","name":"lookup"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"q\\":"}\n\n',
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"\\"x\\"}"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'gpt-5.6-sol' }));

    const parsed = chunks(out);
    const opener = parsed[0]!.choices[0].delta.tool_calls[0];
    expect(opener).toMatchObject({ index: 0, id: 'call_a', type: 'function', function: { name: 'lookup' } });
    const args = parsed.filter((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments)
      .map((c) => c.choices[0].delta.tool_calls[0].function.arguments).join('');
    expect(args).toBe('{"q":"x"}');
    expect(parsed.at(-1)?.choices?.[0]?.finish_reason).toBe('tool_calls');
  });

  it('reports a turn cut off at the output cap as `length`, not a clean stop', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"half an ans"}\n\n',
      'data: {"type":"response.incomplete","response":{"id":"r","usage":{"input_tokens":5,"output_tokens":4096}}}\n\n',
    ]), { model: 'grok-4.5' }));
    const parsed = chunks(out);
    expect(parsed.at(-2)?.choices?.[0]?.finish_reason).toBe('length');
    expect(parsed.at(-1)).toMatchObject({ usage: { completion_tokens: 4096 } });
  });

  it('carries tool-call arguments delivered WHOLE on output_item.done, with no deltas', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"c1","name":"read_file"}}\n\n',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"c1","name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'grok-4.5' }));
    const args = chunks(out).filter((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments)
      .map((c) => c.choices[0].delta.tool_calls[0].function.arguments).join('');
    expect(args).toBe('{"path":"a.ts"}');
  });

  it('opens a call first seen only on output_item.done', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.done","output_index":2,"item":{"type":"function_call","call_id":"c9","name":"search_code","arguments":"{\\"query\\":\\"x\\"}"}}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'grok-4.5' })));
    expect(parsed[0]!.choices[0].delta.tool_calls[0]).toMatchObject({ index: 0, id: 'c9', function: { name: 'search_code' } });
    expect(parsed[1]!.choices[0].delta.tool_calls[0].function.arguments).toBe('{"query":"x"}');
    expect(parsed.at(-1)?.choices?.[0]?.finish_reason).toBe('tool_calls');
  });

  it('does not repeat arguments that already streamed as deltas when the .done frames restate them', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"c1","name":"lookup"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"q\\":1}"}\n\n',
      'data: {"type":"response.function_call_arguments.done","output_index":0,"arguments":"{\\"q\\":1}"}\n\n',
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","call_id":"c1","name":"lookup","arguments":"{\\"q\\":1}"}}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'grok-4.5' }));
    const args = chunks(out).filter((c) => c.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments)
      .map((c) => c.choices[0].delta.tool_calls[0].function.arguments).join('');
    expect(args).toBe('{"q":1}');
  });

  it('terminates a stream that ends without a response.completed frame', async () => {
    const out = await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    ]), { model: 'grok-4.5' }));
    expect(chunks(out).at(-1)?.choices?.[0]?.finish_reason).toBe('stop');
    expect(out.trimEnd().endsWith('data: [DONE]')).toBe(true);
  });

  it('raises an in-band first-chunk failure as a retryable vendor error', async () => {
    const body = sseStream(['data: {"type":"response.failed","response":{"error":{"message":"model overloaded"}}}\n\n']);
    await expect(peekResponsesStreamError(body, 'openai-codex', 'gpt-5.6-sol'))
      .rejects.toThrow(/model overloaded/);
    await expect(peekResponsesStreamError(sseStream(['data: {"type":"response.failed"}\n\n']), 'openai-codex', 'm'))
      .rejects.toBeInstanceOf(VendorRetryableError);
  });

  it('passes a healthy stream through the error peek untouched', async () => {
    const body = await peekResponsesStreamError(
      sseStream(['data: {"type":"response.output_text.delta","delta":"ok"}\n\n']),
      'xai-oauth', 'grok-4.5',
    );
    expect(await drain(body)).toContain('response.output_text.delta');
  });
});

/** The concatenated arguments every emitted tool_call delta carried for slot `slot`. */
function argsFor(parsed: Array<any>, slot = 0): string {
  return parsed
    .flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? [])
    .filter((tc: any) => tc.index === slot && tc.function?.arguments)
    .map((tc: any) => tc.function.arguments)
    .join('');
}

describe('a call xAI delivers whole, or only in the terminal frame', () => {
  it('carries arguments that ride the output_item.added frame, and ignores deltas restating them', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"c1","name":"search_code","arguments":"{\\"query\\":\\"RoomRoster\\"}"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","output_index":0,"delta":"{\\"query\\":\\"RoomRoster\\"}"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'grok-4.6' })));
    expect(argsFor(parsed)).toBe('{"query":"RoomRoster"}');
    expect(parsed.find((c) => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason).toBe('tool_calls');
  });

  it('rebuilds a call that appears ONLY in response.completed — the turn used to arrive with no tool calls', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.completed","response":{"id":"r","output":[{"type":"reasoning","id":"rs_1"},{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":"{\\"path\\":\\"a.ts\\"}"}]}}\n\n',
    ]), { model: 'grok-4.6' })));
    const opener = parsed.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []).find((tc: any) => tc.id);
    expect(opener).toMatchObject({ id: 'call_1', function: { name: 'read_file' } });
    expect(argsFor(parsed, opener.index)).toBe('{"path":"a.ts"}');
    const finish = parsed.find((c) => c.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe('tool_calls');
    expect(finish.x_builderforce_upstream).toEqual({ items: { reasoning: 1, function_call: 1 }, functionCalls: 1, recovered: 1 });
  });

  it('does not repeat a call the stream already opened when the terminal output restates it', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":"{}"}}\n\n',
      'data: {"type":"response.completed","response":{"id":"r","output":[{"type":"function_call","id":"fc_1","call_id":"call_1","name":"read_file","arguments":"{}"}]}}\n\n',
    ]), { model: 'grok-4.6' })));
    expect(parsed.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []).filter((tc: any) => tc.id)).toHaveLength(1);
    expect(parsed.find((c) => c.choices?.[0]?.finish_reason).x_builderforce_upstream).toMatchObject({ functionCalls: 1, recovered: 0 });
  });

  it('emits text that only the terminal output carries, exactly once', async () => {
    const terminal = 'data: {"type":"response.completed","response":{"id":"r","output":[{"type":"message","content":[{"type":"output_text","text":"done"}]}]}}\n\n';
    const onlyTerminal = chunks(await drain(responsesSseToChatSse(sseStream([terminal]), { model: 'grok-4.6' })));
    expect(onlyTerminal.map((c) => c.choices?.[0]?.delta?.content ?? '').join('')).toBe('done');
    const streamedToo = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"done"}\n\n', terminal,
    ]), { model: 'grok-4.6' })));
    expect(streamedToo.map((c) => c.choices?.[0]?.delta?.content ?? '').join('')).toBe('done');
  });

  it('reports a text-only turn as zero structured calls — the model, not the adapter', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_text.delta","delta":"I will now call search_code"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r","output":[{"type":"reasoning"},{"type":"message","content":[{"type":"output_text","text":"I will now call search_code"}]}]}}\n\n',
    ]), { model: 'grok-4.6' })));
    const finish = parsed.find((c) => c.choices?.[0]?.finish_reason);
    expect(finish.choices[0].finish_reason).toBe('stop');
    expect(finish.x_builderforce_upstream).toEqual({ items: { reasoning: 1, message: 1 }, functionCalls: 0, recovered: 0 });
  });

  it('stringifies arguments delivered as an object on output_item.added', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","call_id":"c1","name":"search_code","arguments":{"query":"RoomRoster"}}}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'grok-4.6' })));
    expect(argsFor(parsed)).toBe('{"query":"RoomRoster"}');
    expect(parsed.find((c) => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason).toBe('tool_calls');
  });

  it('rebuilds a tool_call alias that appears only in response.completed', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.completed","response":{"id":"r","output":[{"type":"tool_call","call_id":"call_1","function":{"name":"read_file","arguments":{"path":"a.ts"}}}]}}\n\n',
    ]), { model: 'grok-4.6' })));
    const opener = parsed.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []).find((tc: any) => tc.id);
    expect(opener).toMatchObject({ id: 'call_1', function: { name: 'read_file' } });
    expect(argsFor(parsed, opener.index)).toBe('{"path":"a.ts"}');
    expect(parsed.find((c) => c.choices?.[0]?.finish_reason).x_builderforce_upstream).toMatchObject({ functionCalls: 1, recovered: 1 });
  });

  it('recovers a call that appears only on response.incomplete', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.incomplete","response":{"id":"r","output":[{"type":"function_call","call_id":"c9","name":"search_code","arguments":"{\\"query\\":\\"x\\"}"}]}}\n\n',
    ]), { model: 'grok-4.6' })));
    expect(parsed.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []).some((tc: any) => tc.id === 'c9')).toBe(true);
    expect(parsed.find((c) => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason).toBe('length');
  });

  it('reads the SSE event: field when the JSON body omits type', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'event: response.output_item.added\ndata: {"output_index":0,"item":{"type":"function_call","call_id":"c1","name":"search_code","arguments":"{\\"query\\":\\"x\\"}"}}\n\n',
      'event: response.completed\ndata: {"response":{"id":"r","output":[{"type":"function_call","call_id":"c1","name":"search_code","arguments":"{\\"query\\":\\"x\\"}"}]}}\n\n',
    ]), { model: 'grok-4.6' })));
    expect(parsed.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []).some((tc: any) => tc.id === 'c1')).toBe(true);
    expect(argsFor(parsed)).toBe('{"query":"x"}');
  });

  it('translates OpenAI chat-completions tool_calls mixed onto the Responses stream', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"id":"chatcmpl_1","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"c1","type":"function","function":{"name":"search_code","arguments":"{\\"query\\":\\"x\\"}"}}]}}]}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'grok-4.6' })));
    expect(parsed.flatMap((c) => c.choices?.[0]?.delta?.tool_calls ?? []).some((tc: any) => tc.id === 'c1')).toBe(true);
    expect(argsFor(parsed)).toBe('{"query":"x"}');
    expect(parsed.find((c) => c.choices?.[0]?.finish_reason)?.choices[0].finish_reason).toBe('tool_calls');
  });

  it('routes function_call_arguments.delta by item_id when output_index is missing', async () => {
    const parsed = chunks(await drain(responsesSseToChatSse(sseStream([
      'data: {"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc_1","call_id":"c1","name":"lookup"}}\n\n',
      'data: {"type":"response.function_call_arguments.delta","item_id":"fc_1","delta":"{\\"q\\":1}"}\n\n',
      'data: {"type":"response.completed","response":{"id":"r"}}\n\n',
    ]), { model: 'grok-4.6' })));
    expect(argsFor(parsed)).toBe('{"q":1}');
  });
});

describe('Responses vendors stream for real', () => {
  afterEach(() => vi.restoreAllMocks());

  it('openai-codex pipes the backend SSE through rather than replaying it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      sseStream([
        'data: {"type":"response.output_text.delta","delta":"a"}\n\n',
        'data: {"type":"response.completed","response":{"id":"r","usage":{"input_tokens":1,"output_tokens":1}}}\n\n',
      ]),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    )));

    const result = await openAiCodexModule.callStream!(baseParams);
    const parsed = chunks(await result.response.text());
    expect(parsed[0]!.choices[0].delta.content).toBe('a');
    expect(parsed.at(-1)).toMatchObject({ usage: { prompt_tokens: 1, completion_tokens: 1 } });
  });

  it('openai-codex falls back to the one-shot replay when the backend answers plain JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ id: 'r', output_text: 'json answer', usage: { input_tokens: 2, output_tokens: 3 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )));

    const result = await openAiCodexModule.callStream!(baseParams);
    expect(await result.response.text()).toContain('json answer');
  });

  it('xai-oauth asks for a real stream and translates it', async () => {
    const fetchMock = vi.fn(async () => new Response(
      sseStream(['data: {"type":"response.output_text.delta","delta":"grok"}\n\n', 'data: {"type":"response.completed","response":{"id":"r"}}\n\n']),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await xaiOAuthModule.callStream!({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.5' });
    const sentBody = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(sentBody.stream).toBe(true);
    // Grok's reasoning tokens count against an output cap, so none is sent.
    expect(sentBody.max_output_tokens).toBeUndefined();
    expect(chunks(await result.response.text())[0]!.choices[0].delta.content).toBe('grok');
  });

  it('xai-oauth falls back to the non-streamed call when the backend refuses stream:true', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const streamed = JSON.parse(init.body as string).stream === true;
      return streamed
        ? new Response('{"error":"Unsupported parameter: stream"}', { status: 400 })
        : new Response(JSON.stringify({ id: 'r', output_text: 'buffered' }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await xaiOAuthModule.callStream!({ ...baseParams, apiKey: 'xai-key', model: 'grok-4.5' });
    expect(await result.response.text()).toContain('buffered');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
