import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChatCompletion, type BrainTransport } from './streamChatCompletion';
import { BrainRequestError, chatErrorAction } from './chatError';

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

  // REGRESSION: this used to fall back to a hardcoded `openai/gpt-4o-mini` — a PAID
  // OpenRouter model — so an unpinned free-plan user was silently pinned to the
  // premium tier and every turn died on a 402 ("…require a validated card on file").
  // Omitting the key is what makes the gateway route through the plan's own pool.
  it('omits `model` entirely when nothing is pinned (gateway auto-select)', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({ messages: [], transport: baseTransport });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('model');
  });

  it('preserves the gateway\'s structured entitlement fields on a 402', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: 'Premium models require a validated card on file.',
            code: 'premium_model_not_allowed',
            reason: 'card_required',
            unlock: 'validate_card',
            requiredPlan: 'pro',
            feature: 'premiumModels',
          }),
          { status: 402 },
        ),
      ),
    );

    const err = await streamChatCompletion({ messages: [], transport: baseTransport }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(BrainRequestError);
    expect((err as BrainRequestError).message).toContain('validated card');
    expect((err as BrainRequestError).status).toBe(402);
    expect((err as BrainRequestError).unlock).toBe('validate_card');
    // …and the UI's verdict follows from it, so the banner offers "Add a card"
    // rather than a dead-end sentence.
    expect(chatErrorAction(err)).toEqual({
      kind: 'validate_card',
      requiredPlan: 'pro',
      feature: 'premiumModels',
    });
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

  it('lifts an inline <tool_call> from the text stream and hides the markup', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse([
          'data: {"choices":[{"delta":{"content":"Cleaning up."}}]}\n',
          'data: {"choices":[{"delta":{"content":"<tool_call>delete_task<arg_key>id</arg"}}]}\n',
          'data: {"choices":[{"delta":{"content":"_key><arg_value>75</arg_value></tool_call>"},"finish_reason":"stop"}]}\n',
          'data: [DONE]\n',
        ]),
      ),
    );

    const deltas: string[] = [];
    const result = await streamChatCompletion(
      { messages: [], transport: baseTransport },
      { onTextDelta: (d) => deltas.push(d) },
    );

    // The markup never reaches the display deltas nor the final text.
    expect(deltas.join('')).toBe('Cleaning up.');
    expect(result.text).toBe('Cleaning up.');
    // The call is structured so the agent loop will actually execute it.
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('delete_task');
    expect(JSON.parse(result.toolCalls[0].args)).toEqual({ id: 75 });
  });
});

describe('caller metadata (gateway audit emit)', () => {
  /** Parse the JSON body the mocked fetch was called with. */
  const sentBody = (fetchMock: { mock: { calls: unknown[][] } }): Record<string, unknown> =>
    JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);

  it('emits metadata.chatId (and projectId) when the chat is known', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({
      messages: [{ role: 'user', content: 'hi' }],
      transport: baseTransport,
      metadata: { chatId: 42, projectId: 7 },
    });

    expect(sentBody(fetchMock).metadata).toEqual({ chatId: 42, projectId: 7 });
  });

  it('omits the metadata key entirely when no chat id is known', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({ messages: [{ role: 'user', content: 'hi' }], transport: baseTransport });

    expect(sentBody(fetchMock)).not.toHaveProperty('metadata');
  });

  it('omits the metadata key when every field is undefined', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({
      messages: [],
      transport: baseTransport,
      metadata: { chatId: undefined, projectId: undefined },
    });

    expect(sentBody(fetchMock)).not.toHaveProperty('metadata');
  });
});
