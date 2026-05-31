import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChatCompletion, type BrainTransport } from './streamChatCompletion';

/** Build a Response whose body streams the given SSE lines. */
function sseResponse(lines: string[], init?: ResponseInit): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const l of lines) controller.enqueue(enc.encode(l));
      controller.close();
    },
  });
  return new Response(body, { status: 200, ...init });
}

const baseTransport: BrainTransport = {
  baseUrl: 'https://gw.example',
  getToken: () => 'tok_123',
};

afterEach(() => vi.restoreAllMocks());

describe('streamChatCompletion transport injection', () => {
  it('targets the transport baseUrl and sends the injected bearer token', async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n',
        'data: [DONE]\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const result = await streamChatCompletion(
      { messages: [{ role: 'user', content: 'hi' }], transport: baseTransport },
      { onTextDelta: (d) => deltas.push(d) },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://gw.example/llm/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok_123' });
    expect(result.text).toBe('Hello world');
    expect(deltas.join('')).toBe('Hello world');
  });

  it('uses transport.defaultModel when no model is given', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion(
      { messages: [], transport: { ...baseTransport, defaultModel: 'anthropic/claude' } },
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe('anthropic/claude');
  });

  it('calls onUnauthorized on a 401 and maps the error via transport.mapError', async () => {
    const onUnauthorized = vi.fn();
    const mapError = vi.fn(async () => new Error('mapped-401'));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })));

    await expect(
      streamChatCompletion({
        messages: [],
        transport: { ...baseTransport, onUnauthorized, mapError },
      }),
    ).rejects.toThrow('mapped-401');
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
    expect(mapError).toHaveBeenCalledTimes(1);
  });

  it('assembles streamed tool calls by index', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"create_file","arguments":"{\\"path\\":"}}]}}]}\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"a.ts\\"}"}}]}}]}\n',
          'data: [DONE]\n',
        ]),
      ),
    );
    const result = await streamChatCompletion({ messages: [], transport: baseTransport });
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toMatchObject({ id: 'c1', name: 'create_file', args: '{"path":"a.ts"}' });
  });
});
