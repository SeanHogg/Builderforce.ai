import { describe, expect, it, vi } from 'vitest';
import { BuilderforceClient, BuilderforceApiError, isAIUseCase, type ChatCompletionChunk } from './index';

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

describe('@builderforce/sdk', () => {
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
      const body = JSON.parse(String(init?.body)) as { stream?: boolean; useCase?: string };
      expect(body.stream).toBe(false);
      expect(body.useCase).toBe('ide.chat');
      return createJsonResponse({
        choices: [{ message: { content: 'hello' } }],
        _builderforce: { resolvedModel: 'meta-llama/llama-3.3-70b-instruct:free' },
      });
    });

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const result = await client.chat.completions.create({
      stream: false,
      useCase: 'ide.chat',
      messages: [{ role: 'user', content: 'hi' }],
    });

    expect(result.choices?.[0]?.message?.content).toBe('hello');
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
        days: 7,
        tenantId: 1,
        plan: 'pro',
        effectivePlan: 'pro',
        billingStatus: 'active',
        totals: { requests: 1, totalTokens: 10, promptTokens: 4, completionTokens: 6 },
        mine: { userId: 'u1', requests: 1, totalTokens: 10, promptTokens: 4, completionTokens: 6 },
        byModel: [],
        byDay: [],
        byUser: [],
      });
    });

    const client = new BuilderforceClient({ apiKey: 'clk_test_key', fetch: fetchMock as unknown as typeof fetch });
    const usage = await client.usage.get({ days: 7 });
    expect(usage.days).toBe(7);
    expect(usage.totals.totalTokens).toBe(10);
  });

  it('throws BuilderforceApiError for non-2xx', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ error: 'Unauthorized', code: 'unauthorized' }),
      {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'x-request-id': 'req_123',
        },
      },
    ));
    const client = new BuilderforceClient({ apiKey: 'bad', fetch: fetchMock as unknown as typeof fetch });

    try {
      await client.models.list();
      throw new Error('Expected list() to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(BuilderforceApiError);
      const apiError = error as BuilderforceApiError;
      expect(apiError.status).toBe(401);
      expect(apiError.code).toBe('unauthorized');
      expect(apiError.requestId).toBe('req_123');
    }
  });

  it('throws BuilderforceApiError when apiKey is empty', () => {
    let caught: unknown;
    try {
      new BuilderforceClient({ apiKey: '   ' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BuilderforceApiError);
    const apiError = caught as BuilderforceApiError;
    expect(apiError.status).toBe(400);
    expect(apiError.code).toBe('missing_api_key');
    expect(apiError.message).toMatch(/non-empty apiKey/);
  });

  it('aborts request when timeout elapses', async () => {
    const fetchMock = vi.fn((_: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));

    const client = new BuilderforceClient({
      apiKey: 'clk_test_key',
      timeoutMs: 5,
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.models.list()).rejects.toMatchObject({
      name: 'BuilderforceApiError',
      status: 408,
      code: 'timeout',
    });
  });

  it('exports AIUseCase guard', () => {
    expect(isAIUseCase('ide.chat')).toBe(true);
    expect(isAIUseCase('not.a.usecase')).toBe(false);
  });
});
