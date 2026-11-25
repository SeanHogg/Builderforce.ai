import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiRequestStream = vi.hoisted(() => vi.fn());
vi.mock('@/lib/apiClient', () => ({ apiRequestStream }));

import { CHAT_COMPLETIONS_PATH, webHostRelay } from './webHostRelay';

const encoder = new TextEncoder();
const unfilled = () => Promise.reject(new Error('unfilled'));
const request = { resourceId: 'chat', body: encoder.encode('{"model":"m"}'), stream: true };

function streamed(...parts: string[]): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }));
}

describe('webHostRelay', () => {
  beforeEach(() => apiRequestStream.mockReset());

  it('posts the body to the completions route and streams the chunks', async () => {
    apiRequestStream.mockResolvedValue(streamed('data: a\n\n', 'data: b\n\n'));
    let text = '';
    for await (const chunk of webHostRelay({ connectionSecretsUnfilled: unfilled }).forwardAi(request)) text += new TextDecoder().decode(chunk);
    expect(text).toBe('data: a\n\ndata: b\n\n');
    expect(apiRequestStream).toHaveBeenCalledWith(CHAT_COMPLETIONS_PATH, expect.objectContaining({ method: 'POST', body: request.body, json: true }));
  });

  it('throws on a non-ok answer', async () => {
    apiRequestStream.mockResolvedValue(new Response('no', { status: 402 }));
    await expect(webHostRelay({ connectionSecretsUnfilled: unfilled }).forwardAi(request)[Symbol.asyncIterator]().next()).rejects.toThrow('answered 402');
  });

  it('leaves the connection vault unfilled', async () => {
    await expect(webHostRelay({ connectionSecretsUnfilled: unfilled }).connectionSecrets('c')).rejects.toThrow('unfilled');
  });
});
