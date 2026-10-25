import { describe, it, expect, vi, afterEach } from 'vitest';
import { streamChatCompletion, StreamInterruptedError, RepetitionLoopError, type BrainTransport } from './streamChatCompletion';
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

describe('streamChatCompletion onModel', () => {
  const chunk = (content: string, model?: string): string =>
    `data: ${JSON.stringify({ ...(model ? { model } : {}), choices: [{ delta: { content } }] })}\n`;

  it('names the serving model once, from the header, with the account that served it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(
      [chunk('Hi', 'chunk/model'), chunk(' there', 'chunk/model'), 'data: [DONE]\n'],
      { headers: { 'x-builderforce-model': 'xai-oauth/grok-4.6', 'x-builderforce-account': 'own' } },
    )));
    const onModel = vi.fn();
    await streamChatCompletion({ messages: [], transport: baseTransport }, { onModel });
    expect(onModel).toHaveBeenCalledTimes(1);
    expect(onModel).toHaveBeenCalledWith('xai-oauth/grok-4.6', 'own');
  });

  it("falls back to the first chunk's model, before any text is handed over", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([chunk('Hi', 'direct/minimax/MiniMax-M2.7'), 'data: [DONE]\n'])));
    const order: string[] = [];
    await streamChatCompletion(
      { messages: [], transport: baseTransport },
      { onModel: (model) => order.push(`model:${model}`), onTextDelta: (d) => order.push(`text:${d}`) },
    );
    expect(order).toEqual(['model:direct/minimax/MiniMax-M2.7', 'text:Hi']);
  });
});

describe('streamChatCompletion upstream evidence', () => {
  it('surfaces what the vendor\'s raw response carried, from the finishing chunk', async () => {
    const evidence = { items: { reasoning: 1, message: 1 }, functionCalls: 0, recovered: 0 };
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'I will call search_code' } }] })}\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], x_builderforce_upstream: evidence })}\n`,
      'data: [DONE]\n',
    ])));
    const result = await streamChatCompletion({ messages: [], transport: baseTransport }, {});
    expect(result.upstream).toEqual(evidence);
  });

  it('leaves it unset for a vendor that does not report one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' }, finish_reason: 'stop' }] })}\n`,
      'data: [DONE]\n',
    ])));
    expect((await streamChatCompletion({ messages: [], transport: baseTransport }, {})).upstream).toBeUndefined();
  });
});

describe('streamChatCompletion repetition guard', () => {
  const sentence = "I'll start by checking this chat's linked tickets and locating the Room bubble code. ";
  const frames = (copies: number): string[] => [
    ...Array.from({ length: copies }, () => `data: ${JSON.stringify({ choices: [{ delta: { content: sentence } }] })}\n`),
    'data: [DONE]\n',
  ];

  it('cuts a stream that loops on one sentence and names the model so the caller can route around it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames(20), { headers: { 'x-builderforce-model': 'direct/qwen/qwen3.8-max' } })));
    const deltas: string[] = [];
    const err = await streamChatCompletion(
      { messages: [], transport: baseTransport },
      { onTextDelta: (d) => deltas.push(d) },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RepetitionLoopError);
    // Still an interruption, so the Brain run's retry-on-another-model path takes it.
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as RepetitionLoopError).model).toBe('direct/qwen/qwen3.8-max');
    expect((err as RepetitionLoopError).kept).toBe(sentence);
    expect((err as RepetitionLoopError).message).toMatch(/stuck repeating itself/);
    // The copy that completed the loop was never shown.
    expect(deltas.join('')).toBe(sentence.repeat(2));
  });

  it('lets a sentence said twice finish normally', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(frames(2))));
    const result = await streamChatCompletion({ messages: [], transport: baseTransport });
    expect(result.text).toBe(sentence.repeat(2));
  });
});

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

  it('returns the gateway-resolved model and vendor for session diagnostics', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: [DONE]\n'], {
      headers: { 'x-builderforce-model': 'provider/model-1', 'x-builderforce-vendor': 'provider' },
    })));

    const result = await streamChatCompletion({ messages: [], transport: baseTransport });

    expect(result.resolvedModel).toBe('provider/model-1');
    expect(result.resolvedVendor).toBe('provider');
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

  it('sends a deliberate model choice as a strict pin', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({
      messages: [], transport: baseTransport, model: 'direct/kimi-code/kimi-k2.5', modelStrict: true,
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ model: 'direct/kimi-code/kimi-k2.5', strict: true });
  });

  // Kimi Code answered both of these with a 400 (verified against the live API
  // 2026-10-25): numeric `metadata` → "Invalid request Error", and K3 → "invalid
  // temperature: only 1 is allowed". A provider's own route gets the plain OpenAI body.
  it('sends a provider route (wire: openai) no gateway-only field', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({
      messages: [], transport: { ...baseTransport, wire: 'openai' }, model: 'k3', modelStrict: true,
      routingMode: 'byo_pool', excludeModels: ['x'], role: 'code', arcStage: 'build',
      reasoning: { level: 'high' }, metadata: { projectId: 11, chatId: 5091 }, prompt_cache_key: 'chat-5091',
    } as Parameters<typeof streamChatCompletion>[0]);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    for (const key of ['strict', 'routingMode', 'excludeModels', 'role', 'arcStage', 'reasoning', 'metadata']) {
      expect(body).not.toHaveProperty(key);
    }
    expect(body).toMatchObject({ model: 'k3', temperature: 0.3, stream: true, prompt_cache_key: 'chat-5091' });
  });

  it('sends no temperature when the provider chooses sampling', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({ messages: [], transport: { ...baseTransport, wire: 'openai', providerSampling: true }, model: 'k3', temperature: 0.7 });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).not.toHaveProperty('temperature');
  });

  it('distinguishes ordered BYO Pool from gateway Auto on the wire', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);

    await streamChatCompletion({ messages: [], transport: baseTransport, routingMode: 'byo_pool' });
    let body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ routingMode: 'byo_pool' });
    expect(body).not.toHaveProperty('model');

    await streamChatCompletion({ messages: [], transport: baseTransport, routingMode: 'auto' });
    body = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(body).toMatchObject({ routingMode: 'auto' });
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

describe('a model that breaks after the stream opened', () => {
  it('turns an in-band error frame into StreamInterruptedError naming the model', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        sseResponse(
          [
            'data: {"choices":[{"delta":{"content":"Working on it"}}]}\n',
            'data: {"error":{"message":"response.failed: upstream overloaded"}}\n',
          ],
          { headers: { 'x-builderforce-model': 'xai-oauth/grok-4.5' } },
        ),
      ),
    );
    const err = await streamChatCompletion({ messages: [], transport: baseTransport }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as StreamInterruptedError).model).toBe('xai-oauth/grok-4.5');
    expect((err as Error).message).toContain('upstream overloaded');
  });

  it('turns a dropped connection into StreamInterruptedError rather than a silent stop', async () => {
    // The first read delivers a chunk; the NEXT read fails, as a dropped socket does.
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode('data: {"model":"direct/xai/grok-4.5","choices":[{"delta":{"content":"Half"}}]}\n'));
        else controller.error(new Error('socket hang up'));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const err = await streamChatCompletion({ messages: [], transport: baseTransport }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as StreamInterruptedError).model).toBe('direct/xai/grok-4.5');
  });

  it('turns a stream that goes SILENT into StreamInterruptedError instead of hanging', async () => {
    // A stalled upstream keeps the socket open and never settles the next read, so the
    // turn used to wait forever (or until the user pressed Stop). One chunk, then
    // nothing: the idle watchdog ends it and names the model to route around.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"model":"xai-oauth/grok-4.6","choices":[{"delta":{"content":"Writing"}}]}\n'));
      },
      // No `pull`: the stream never produces another byte and never closes.
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const err = await streamChatCompletion({ messages: [], transport: baseTransport, idleTimeoutMs: 20 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as Error).message).toContain('went silent');
    expect((err as StreamInterruptedError).model).toBe('xai-oauth/grok-4.6');
  });

  it('bounds the wait for response HEADERS by the same silence rule', async () => {
    // A gateway that accepts the socket and never answers: the fetch settles only when
    // its signal aborts. The canvas once carried a private watchdog for exactly this.
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
    })));
    const err = await streamChatCompletion({ messages: [], model: 'free/model', transport: baseTransport, idleTimeoutMs: 20 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as Error).message).toContain('sent nothing');
    expect((err as StreamInterruptedError).model).toBe('free/model');
  });

  it('treats a user Stop before the headers as a cancellation, not a silent gateway', async () => {
    const stop = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })));
    })));
    const pending = streamChatCompletion({ messages: [], transport: baseTransport, idleTimeoutMs: 60_000, signal: stop.signal }).catch((e: unknown) => e);
    stop.abort();
    const err = await pending;
    expect(err).not.toBeInstanceOf(StreamInterruptedError);
    expect((err as Error).name).toBe('AbortError');
  });

  it('treats a user Stop as a cancellation, never as a silent stream', async () => {
    const controllerAbort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"model":"xai-oauth/grok-4.6","choices":[{"delta":{"content":"Hi"}}]}\n'));
        controllerAbort.abort();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })));
    const err = await streamChatCompletion({
      messages: [], transport: baseTransport, idleTimeoutMs: 20, signal: controllerAbort.signal,
    }).catch((e: unknown) => e);
    // Whatever surfaced, it must NOT be dressed up as an upstream interruption.
    if (err instanceof Error) expect(err.message).not.toContain('went silent');
  });

  it('sends excludeModels so a retry routes around the model that broke', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);
    await streamChatCompletion({ messages: [], transport: baseTransport, excludeModels: ['xai-oauth/grok-4.5'] });
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(init.body)).excludeModels).toEqual(['xai-oauth/grok-4.5']);
  });

  it('sends the role and the canvas arc stage the gateway orders by, and omits them when unset', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n']));
    vi.stubGlobal('fetch', fetchMock);
    await streamChatCompletion({ messages: [], transport: baseTransport, role: 'code', arcStage: 'make' });
    await streamChatCompletion({ messages: [], transport: baseTransport });
    const bodyOf = (i: number) => JSON.parse(String((fetchMock.mock.calls[i] as unknown as [string, RequestInit])[1].body));
    expect(bodyOf(0)).toMatchObject({ role: 'code', arcStage: 'make' });
    expect(bodyOf(1)).not.toHaveProperty('arcStage');
    expect(bodyOf(1)).not.toHaveProperty('role');
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

describe('header deadline vs connect-failure backoff', () => {
  afterEach(() => vi.useRealTimers());

  const refused = (): TypeError =>
    Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) });

  it('starts the header deadline per attempt, so backoff longer than the idle budget is not "gateway sent nothing"', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls <= 2) throw refused();
      return sseResponse([`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n`, 'data: [DONE]\n']);
    }));
    // Backoff before the third attempt is 1s + 2s — far past the 50ms header budget.
    const pending = streamChatCompletion({ messages: [], transport: baseTransport, idleTimeoutMs: 50 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3_500);
    const result = await pending;
    expect(result).not.toBeInstanceOf(StreamInterruptedError);
    expect(calls).toBe(3);
    expect((result as { text: string }).text).toBe('ok');
  });

  it('still trips the header deadline on an attempt that connected and then went silent', async () => {
    vi.useFakeTimers();
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
      calls += 1;
      if (calls === 1) return Promise.reject(refused());
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      });
    }));
    const pending = streamChatCompletion({ messages: [], model: 'm/x', transport: baseTransport, idleTimeoutMs: 50 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_100);
    const err = await pending;
    expect(err).toBeInstanceOf(StreamInterruptedError);
    expect((err as Error).message).toContain('sent nothing');
    expect(calls).toBe(2);
  });

  it("removes its abort listener from the caller's signal once the completion settles", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse(['data: [DONE]\n'])));
    const stop = new AbortController();
    const add = vi.spyOn(stop.signal, 'addEventListener');
    const remove = vi.spyOn(stop.signal, 'removeEventListener');
    await streamChatCompletion({ messages: [], transport: baseTransport, signal: stop.signal });
    const added = add.mock.calls.filter(([type]) => type === 'abort').map(([, fn]) => fn);
    const removed = remove.mock.calls.filter(([type]) => type === 'abort').map(([, fn]) => fn);
    expect(added).toHaveLength(1);
    expect(removed).toContain(added[0]);
  });
});
