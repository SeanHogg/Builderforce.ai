import { describe, expect, it } from 'vitest';
import { readSseData, sseDataPayload } from './sseFrames';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(chunks: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (const data of readSseData(streamOf(chunks))) out.push(data);
  return out;
}

describe('readSseData', () => {
  it('yields each data frame and stops at [DONE]', async () => {
    expect(await collect(['data: {"a":1}\n\ndata: {"a":2}\n\ndata: [DONE]\n\ndata: {"a":3}\n'])).toEqual(['{"a":1}', '{"a":2}']);
  });

  it('reassembles a frame split across chunks', async () => {
    expect(await collect(['data: {"long":"val', 'ue"}\n', 'data: [DONE]\n'])).toEqual(['{"long":"value"}']);
  });

  it('flushes a final frame with no trailing newline', async () => {
    expect(await collect(['data: {"a":1}'])).toEqual(['{"a":1}']);
  });

  it('ignores comments, events and blank lines', async () => {
    expect(await collect([': keep-alive\nevent: ping\n\ndata:{"x":1}\n'])).toEqual(['{"x":1}']);
    expect(sseDataPayload('id: 4')).toBeUndefined();
  });

  it('is empty for a missing body', async () => {
    const out: string[] = [];
    for await (const data of readSseData(null)) out.push(data);
    expect(out).toEqual([]);
  });
});
