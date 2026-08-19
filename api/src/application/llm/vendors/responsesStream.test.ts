import { afterEach, describe, expect, it, vi } from 'vitest';
import { peekResponsesStreamError, responsesSseToChatSse } from './responsesStream';
import { openAiCodexModule } from './openaiCodex';
import { xaiOAuthModule } from './xaiOAuth';
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
