/**
 * The stream tee is the only place a streamed call's tokens AND its completion
 * body can be observed, so both halves are pinned here — plus the delivery
 * guarantee that makes it safe to put on a live response.
 */
import { describe, it, expect, vi } from 'vitest';
import { wrapStreamForTrace, type StreamedCompletion } from './streamTrace';
import type { LlmUsage } from './LlmProxyService';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

/** First recorded argument of a spy, asserted present — `noUncheckedIndexedAccess`
 *  otherwise makes every `mock.calls[0][0]` a possibly-undefined read. */
function firstArg<T>(spy: { mock: { calls: T[][] } }): T {
  const call = spy.mock.calls[0];
  expect(call).toBeDefined();
  return call![0] as T;
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
  return out + decoder.decode();
}

describe('wrapStreamForTrace', () => {
  it('reassembles the completion body and reports usage', async () => {
    const onUsage = vi.fn<(u: LlmUsage) => void>();
    const onComplete = vi.fn<(c: StreamedCompletion) => void>();
    const source = sseStream([
      'data: {"model":"vendor/m1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":", world"},"finish_reason":"stop"}]}\n\n',
      'data: {"usage":{"prompt_tokens":11,"completion_tokens":4,"total_tokens":15}}\n\n',
      'data: [DONE]\n\n',
    ]);

    const passedThrough = await drain(wrapStreamForTrace(source, { onUsage, onComplete }));

    // Delivery is byte-for-byte — the tee must never alter what the client sees.
    expect(passedThrough).toContain('data: [DONE]');
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(firstArg(onUsage)).toMatchObject({ promptTokens: 11, completionTokens: 4, totalTokens: 15 });
    expect(onComplete).toHaveBeenCalledTimes(1);
    const completion = firstArg(onComplete);
    expect(completion.content).toBe('Hello, world');
    expect(completion.finishReason).toBe('stop');
    expect(completion.model).toBe('vendor/m1');
    expect(completion.usage).toMatchObject({ totalTokens: 15 });
  });

  it('reads a frame split across chunk boundaries', async () => {
    // The previous per-chunk `split("\n")` scrape lost a frame that arrived in two
    // pieces, which is exactly how a large delta reaches the worker.
    const onComplete = vi.fn<(c: StreamedCompletion) => void>();
    const source = sseStream([
      'data: {"choices":[{"delta":{"cont',
      'ent":"split"}}]}\n\ndata: [DONE]\n\n',
    ]);
    await drain(wrapStreamForTrace(source, { onComplete }));
    expect(firstArg(onComplete).content).toBe('split');
  });

  it('assembles streamed tool calls across deltas', async () => {
    const onComplete = vi.fn<(c: StreamedCompletion) => void>();
    const source = sseStream([
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.ts\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ]);
    await drain(wrapStreamForTrace(source, { onComplete }));
    expect(firstArg(onComplete).toolCalls).toEqual([
      { id: 'call_1', name: 'read_file', arguments: '{"path":"a.ts"}' },
    ]);
  });

  it('still delivers the stream when a callback throws', async () => {
    // Tracing is never on the critical path: a thrower must not break delivery.
    const source = sseStream(['data: {"choices":[{"delta":{"content":"ok"}}]}\n\n', 'data: [DONE]\n\n']);
    const out = await drain(wrapStreamForTrace(source, {
      onComplete: () => { throw new Error('trace write blew up'); },
    }));
    expect(out).toContain('"content":"ok"');
  });

  it('emits nothing for usage when the stream carried none', async () => {
    const onUsage = vi.fn<(u: LlmUsage) => void>();
    const onComplete = vi.fn<(c: StreamedCompletion) => void>();
    await drain(wrapStreamForTrace(sseStream(['data: [DONE]\n\n']), { onUsage, onComplete }));
    expect(onUsage).not.toHaveBeenCalled();
    expect(firstArg(onComplete).usage).toBeNull();
  });
});
