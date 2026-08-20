import { describe, it, expect, vi } from 'vitest';
import { instrumentStream } from './streamDiagnostics';

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
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
  return out + decoder.decode();
}

const payload = {
  failovers: [{ model: 'a/one', vendor: 'openrouter', code: 429, kind: 'rate_limit' }],
  resolvedModel: 'a/two',
  resolvedVendor: 'openrouter',
  traceId: 'llm-abc',
};

const delta = (text: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;

describe('instrumentStream — surfacing failovers on a stream', () => {
  it('emits ONE terminal frame carrying failovers, immediately BEFORE [DONE]', async () => {
    const out = await drain(instrumentStream(
      sseStream([delta('hi'), 'data: [DONE]\n\n']),
      { payload },
    ));

    const doneAt = out.indexOf('data: [DONE]');
    const diagAt = out.indexOf('_builderforce');
    expect(diagAt).toBeGreaterThan(-1);
    // A client that stops reading at the documented terminator must still see it.
    expect(diagAt).toBeLessThan(doneAt);
    expect(out.match(/_builderforce/g)).toHaveLength(1);
  });

  it('the terminal frame is a VALID chunk, so a strict client can parse it', async () => {
    const out = await drain(instrumentStream(sseStream([delta('hi'), 'data: [DONE]\n\n']), { payload }));
    const line = out.split('\n').find((l) => l.includes('_builderforce'))!;
    const frame = JSON.parse(line.slice('data: '.length)) as Record<string, unknown>;

    expect(frame.object).toBe('chat.completion.chunk');
    expect(frame.model).toBe('a/two');
    // Empty `choices` is the convention vendors already use for a terminal usage
    // frame — every SSE client has to tolerate it. A bare `{_builderforce}` would not.
    expect(frame.choices).toEqual([]);
    expect(frame._builderforce).toMatchObject({
      failovers: payload.failovers,
      resolvedModel: 'a/two',
      resolvedVendor: 'openrouter',
      traceId: 'llm-abc',
    });
  });

  it('passes the original bytes through unchanged', async () => {
    const body = delta('hello') + delta(' world');
    const out = await drain(instrumentStream(sseStream([body, 'data: [DONE]\n\n']), { payload }));
    expect(out.startsWith(body)).toBe(true);
  });

  it('still emits the frame when the vendor closes without [DONE]', async () => {
    const out = await drain(instrumentStream(sseStream([delta('hi')]), { payload }));
    expect(out).toContain('_builderforce');
  });

  it('survives a data: line split across two network chunks', async () => {
    const line = delta('split me');
    const out = await drain(instrumentStream(
      sseStream([line.slice(0, 12), line.slice(12), 'data: [DONE]\n\n']),
      { payload },
    ));
    expect(out).toContain('split me');
    expect(out.match(/_builderforce/g)).toHaveLength(1);
  });
});

describe('instrumentStream — empty-but-200 detection', () => {
  it('reports a stream that closed with no content at all', async () => {
    const onEmptyStream = vi.fn();
    // The failure this exists for: the upstream accepts, burns 10-20s, and returns a
    // well-formed 200 stream with nothing in it. `dispatchVendor`'s validate hook
    // cannot see this — it runs before any bytes exist — so the model was never cooled.
    await drain(instrumentStream(
      sseStream([`data: ${JSON.stringify({ choices: [{ delta: {} }] })}\n\n`, 'data: [DONE]\n\n']),
      { payload, onEmptyStream },
    ));
    expect(onEmptyStream).toHaveBeenCalledTimes(1);
  });

  it('does NOT report a stream that produced content', async () => {
    const onEmptyStream = vi.fn();
    await drain(instrumentStream(sseStream([delta('x'), 'data: [DONE]\n\n']), { payload, onEmptyStream }));
    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it('does NOT report a tool-call-only stream — that IS output', async () => {
    const onEmptyStream = vi.fn();
    const toolCall = `data: ${JSON.stringify({
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'search' } }] } }],
    })}\n\n`;
    await drain(instrumentStream(sseStream([toolCall, 'data: [DONE]\n\n']), { payload, onEmptyStream }));
    expect(onEmptyStream).not.toHaveBeenCalled();
  });

  it('does NOT report a reasoning-only stream', async () => {
    const onEmptyStream = vi.fn();
    const reasoning = `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'thinking' } }] })}\n\n`;
    await drain(instrumentStream(sseStream([reasoning, 'data: [DONE]\n\n']), { payload, onEmptyStream }));
    expect(onEmptyStream).not.toHaveBeenCalled();
  });
});
