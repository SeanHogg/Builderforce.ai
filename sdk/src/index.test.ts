import { describe, expect, it, vi } from 'vitest';
import { BuilderforceClient, BuilderforceApiError, type ChatCompletionChunk, type ToolSpec } from './index';

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSseResponse(lines: string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const line of lines) {
        controller.enqueue(encoder.encode(`${line}\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('@seanhogg/builderforce-sdk', () => {
  it('sends auth header for models.list()', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.builderforce.ai/llm/v1/models');
      expect(init?.headers).toMatchObject({ Authorization: 'Bearer clk_test_key' });
      return createJsonResponse({ configured: true, data: [] });
    });

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.models.list();
    expect(result.configured).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('posts non-stream chat completion', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { stream?: boolean };
      expect(body.stream).toBe(false);
      return createJsonResponse({
        choices: [{ message: { content: 'hello' } }],
        _builderforce: { resolvedModel: 'meta-llama/llama-3.3-70b-instruct:free' },
      });
    });

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.chat.completions.create({
      stream: false,
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.choices?.[0]?.message?.content).toBe('hello');
  });

  it('forwards tools / tool_choice and surfaces tool_calls in response', async () => {
    const tools: ToolSpec[] = [{
      type: 'function',
      function: {
        name: 'get_weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    }];

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.tools).toEqual(tools);
      expect(body.tool_choice).toBe('auto');
      return createJsonResponse({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } }],
          },
          finish_reason: 'tool_calls',
        }],
      });
    });

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.chat.completions.create({
      tools,
      tool_choice: 'auto',
      messages: [{ role: 'user', content: 'Weather in Tokyo?' }],
    });

    const call = result.choices?.[0]?.message?.tool_calls?.[0];
    expect(call?.function.name).toBe('get_weather');
    expect(JSON.parse(call!.function.arguments)).toEqual({ city: 'Tokyo' });
  });

  it('forwards response_format json_schema', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { response_format?: unknown };
      expect(body.response_format).toEqual({
        type: 'json_schema',
        json_schema: { name: 'X', schema: { type: 'object' }, strict: true },
      });
      return createJsonResponse({ choices: [{ message: { content: '{}' } }] });
    });

    const client = new BuilderforceClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await client.chat.completions.create({
      response_format: { type: 'json_schema', json_schema: { name: 'X', schema: { type: 'object' }, strict: true } },
      messages: [{ role: 'user', content: 'go' }],
    });
  });

  it('accepts vision content blocks (string | ContentPart[])', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: unknown }> };
      const content = body.messages[0]!.content as Array<{ type: string }>;
      expect(content[0]!.type).toBe('text');
      expect(content[1]!.type).toBe('image_url');
      return createJsonResponse({ choices: [{ message: { content: 'a cat' } }] });
    });

    const client = new BuilderforceClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await client.chat.completions.create({
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'What is in this image?' },
          { type: 'image_url', image_url: { url: 'https://x/y.jpg' } },
        ],
      }],
    });
  });

  it('sends Idempotency-Key header without leaking it into the body', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'Idempotency-Key': 'tool-run-42' });
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.idempotencyKey).toBeUndefined();
      expect(body.timeoutMs).toBeUndefined();
      return createJsonResponse({ choices: [] });
    });

    const client = new BuilderforceClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await client.chat.completions.create({
      idempotencyKey: 'tool-run-42',
      timeoutMs: 1000,
      messages: [{ role: 'user', content: 'hi' }],
    });
  });

  it('honors per-call timeoutMs override', async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const client = new BuilderforceClient({
      apiKey: 'k',
      timeoutMs: 60_000, // client default — would not fire in time
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(
      client.chat.completions.create({
        timeoutMs: 5,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ name: 'BuilderforceApiError', status: 408, code: 'timeout' });
  });

  it('honors caller AbortSignal with code "aborted"', async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const ctl = new AbortController();
    const client = new BuilderforceClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    setTimeout(() => ctl.abort(), 5);

    await expect(
      client.chat.completions.create({
        signal: ctl.signal,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    ).rejects.toMatchObject({ name: 'BuilderforceApiError', status: 499, code: 'aborted' });
  });

  it('iterates streaming chat completion chunks', async () => {
    const fetchMock = vi.fn(async () => createSseResponse([
      'data: {"choices":[{"delta":{"content":"hel"}}]}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      'data: [DONE]',
    ]));

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const stream = await client.chat.completions.create({
      stream: true,
      messages: [{ role: 'user', content: 'Say hello' }],
    });

    const chunks: ChatCompletionChunk[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(2);
    expect(chunks[0].choices?.[0]?.delta?.content).toBe('hel');
    expect(chunks[1].choices?.[0]?.delta?.content).toBe('lo');
  });

  it('converts streaming chunks to text with toText()', async () => {
    const fetchMock = vi.fn(async () => createSseResponse([
      'data: {"choices":[{"delta":{"content":"Build"}}]}',
      'data: {"choices":[{"delta":{"content":"erforce"}}]}',
      'data: [DONE]',
    ]));

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const stream = await client.chat.completions.create({
      stream: true,
      messages: [{ role: 'user', content: 'Name?' }],
    });

    await expect(stream.toText()).resolves.toBe('Builderforce');
  });

  it('gets usage with days query parameter', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.builderforce.ai/llm/v1/usage?days=7');
      return createJsonResponse({
        days: 7, tenantId: 1, plan: 'pro', effectivePlan: 'pro', billingStatus: 'active',
        totals: { requests: 1, totalTokens: 10, promptTokens: 4, completionTokens: 6 },
        mine:   { userId: 'u1', requests: 1, totalTokens: 10, promptTokens: 4, completionTokens: 6 },
        byModel: [], byDay: [], byUser: [],
      });
    });

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const usage = await client.usage.get({ days: 7 });
    expect(usage.days).toBe(7);
  });

  it('posts to /llm/v1/embeddings', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.builderforce.ai/llm/v1/embeddings');
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      expect(body.input).toEqual(['a', 'b']);
      return createJsonResponse({
        object: 'list',
        data: [
          { object: 'embedding', index: 0, embedding: [0.1, 0.2] },
          { object: 'embedding', index: 1, embedding: [0.3, 0.4] },
        ],
        model: 'mock',
      });
    });

    const client = new BuilderforceClient({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const res = await client.embeddings.create({ input: ['a', 'b'] });
    expect(res.data).toHaveLength(2);
  });

  it('throws BuilderforceApiError for non-2xx', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unauthorized', code: 'unauthorized' }),
      { status: 401, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_123' } },
    ));
    const client = new BuilderforceClient({ apiKey: 'bad', fetch: fetchMock as unknown as typeof fetch });

    await expect(client.models.list()).rejects.toMatchObject({
      name: 'BuilderforceApiError', status: 401, code: 'unauthorized', requestId: 'req_123',
    });
  });

  it('throws BuilderforceApiError when apiKey is empty', () => {
    expect(() => new BuilderforceClient({ apiKey: '   ' })).toThrowError(
      expect.objectContaining({ name: 'BuilderforceApiError', status: 400, code: 'missing_api_key' }),
    );
  });

  it('aborts request when client-level timeout elapses', async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const client = new BuilderforceClient({
      apiKey: 'clk_test_key',
      timeoutMs: 5,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.models.list()).rejects.toMatchObject({
      name: 'BuilderforceApiError', status: 408, code: 'timeout',
    });
  });
});
