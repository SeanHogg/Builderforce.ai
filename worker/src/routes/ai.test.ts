import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  FREE_MODELS,
  OPENROUTER_ENDPOINT,
  getNextModelIndex,
  resetModelIndex,
  withSystemPrompt,
  streamCloudflareAI,
  streamOpenRouter,
  streamAIResponse,
} from '../services/ai';
import type { ChatMessage, AIEnv } from '../services/ai';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const userMsg: ChatMessage = { role: 'user', content: 'Hello' };
const systemMsg: ChatMessage = { role: 'system', content: 'Custom system prompt' };

function makeStream(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function okStreamResponse(): Response {
  return new Response(makeStream('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

// ---------------------------------------------------------------------------
// FREE_MODELS
// ---------------------------------------------------------------------------

describe('FREE_MODELS', () => {
  it('contains at least one model', () => {
    expect(FREE_MODELS.length).toBeGreaterThan(0);
  });

  it('every entry ends with ":free"', () => {
    for (const model of FREE_MODELS) {
      expect(model.endsWith(':free')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// OPENROUTER_ENDPOINT
// ---------------------------------------------------------------------------

describe('OPENROUTER_ENDPOINT', () => {
  it('points to the OpenRouter chat completions URL', () => {
    expect(OPENROUTER_ENDPOINT).toBe('https://openrouter.ai/api/v1/chat/completions');
  });
});

// ---------------------------------------------------------------------------
// getNextModelIndex / resetModelIndex
// ---------------------------------------------------------------------------

describe('getNextModelIndex', () => {
  beforeEach(() => resetModelIndex());

  it('starts at 0', () => {
    expect(getNextModelIndex()).toBe(0);
  });

  it('advances by 1 on each call', () => {
    expect(getNextModelIndex()).toBe(0);
    expect(getNextModelIndex()).toBe(1);
    expect(getNextModelIndex()).toBe(2);
  });

  it('wraps around after the last model', () => {
    for (let i = 0; i < FREE_MODELS.length; i++) getNextModelIndex();
    expect(getNextModelIndex()).toBe(0);
  });

  it('visits every model exactly once in a full cycle', () => {
    const seen = new Set<number>();
    for (let i = 0; i < FREE_MODELS.length; i++) seen.add(getNextModelIndex());
    expect(seen.size).toBe(FREE_MODELS.length);
  });
});

// ---------------------------------------------------------------------------
// withSystemPrompt
// ---------------------------------------------------------------------------

describe('withSystemPrompt', () => {
  it('prepends a system message when none is present', () => {
    const result = withSystemPrompt([userMsg]);
    expect(result[0].role).toBe('system');
    expect(result[1]).toEqual(userMsg);
  });

  it('does not add a second system message when one already exists', () => {
    const result = withSystemPrompt([systemMsg, userMsg]);
    expect(result.filter(m => m.role === 'system')).toHaveLength(1);
    expect(result[0]).toEqual(systemMsg);
  });

  it('preserves message order', () => {
    const msgs: ChatMessage[] = [userMsg, { role: 'assistant', content: 'Hi' }];
    const result = withSystemPrompt(msgs);
    expect(result[1]).toEqual(userMsg);
    expect(result[2].role).toBe('assistant');
  });
});

// ---------------------------------------------------------------------------
// streamCloudflareAI
// ---------------------------------------------------------------------------

describe('streamCloudflareAI', () => {
  it('returns a text/event-stream Response when AI returns a ReadableStream', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue(makeStream('data: {"response":"hi"}\n\n')),
    } as unknown as Ai;

    const res = await streamCloudflareAI([userMsg], mockAI);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });

  it('passes messages to ai.run', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue(makeStream('')),
    } as unknown as Ai;

    await streamCloudflareAI([userMsg], mockAI);
    expect(mockAI.run).toHaveBeenCalledOnce();
    const [, opts] = (mockAI.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.messages).toEqual([userMsg]);
    expect(opts.stream).toBe(true);
  });

  it('wraps a non-streaming (text) response into an SSE body', async () => {
    const mockAI = {
      run: vi.fn().mockResolvedValue({ response: 'plain text answer' }),
    } as unknown as Ai;

    const res = await streamCloudflareAI([userMsg], mockAI);
    const text = await res.text();
    expect(text).toContain('"plain text answer"');
    expect(text).toContain('[DONE]');
  });
});

// ---------------------------------------------------------------------------
// streamOpenRouter — round-robin & 429 failover
// ---------------------------------------------------------------------------

describe('streamOpenRouter', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetModelIndex();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  it('calls the OpenRouter endpoint with Authorization header', async () => {
    fetchSpy.mockResolvedValueOnce(okStreamResponse());

    await streamOpenRouter([userMsg], 'test-key');

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENROUTER_ENDPOINT);
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
  });

  it('sends the first free model on the first attempt', async () => {
    fetchSpy.mockResolvedValueOnce(okStreamResponse());

    await streamOpenRouter([userMsg], 'key');
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body as string);
    expect(body.model).toBe(FREE_MODELS[0]);
  });

  it('skips a rate-limited (429) model and tries the next one', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('rate limited', { status: 429 }))
      .mockResolvedValueOnce(okStreamResponse());

    const res = await streamOpenRouter([userMsg], 'key');
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchSpy.mock.calls[1][1].body as string);
    expect(secondBody.model).toBe(FREE_MODELS[1]);
  });

  it('skips an errored model and tries the next one', async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response('error', { status: 500 }))
      .mockResolvedValueOnce(okStreamResponse());

    const res = await streamOpenRouter([userMsg], 'key');
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns 503 when every model is rate limited', async () => {
    fetchSpy.mockResolvedValue(new Response('rate limited', { status: 429 }));

    const res = await streamOpenRouter([userMsg], 'key');
    expect(res.status).toBe(503);
    expect(fetchSpy).toHaveBeenCalledTimes(FREE_MODELS.length);
  });

  it('returns a streaming Response on success', async () => {
    fetchSpy.mockResolvedValueOnce(okStreamResponse());

    const res = await streamOpenRouter([userMsg], 'key');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
  });
});

// ---------------------------------------------------------------------------
// streamAIResponse — provider selection & A/B mode
// ---------------------------------------------------------------------------

describe('streamAIResponse', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetModelIndex();
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
  });

  function makeAIMock(): Ai {
    return {
      run: vi.fn().mockResolvedValue(makeStream('data: {"response":"cf"}\n\n')),
    } as unknown as Ai;
  }

  it('uses Cloudflare AI when AI_PROVIDER is "cloudflare"', async () => {
    const mockAI = makeAIMock();
    const env: AIEnv = { AI: mockAI, AI_PROVIDER: 'cloudflare' };

    const res = await streamAIResponse([userMsg], env);
    expect(res.status).toBe(200);
    expect(mockAI.run).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('defaults to Cloudflare AI when AI_PROVIDER is not set', async () => {
    const mockAI = makeAIMock();
    const env: AIEnv = { AI: mockAI };

    const res = await streamAIResponse([userMsg], env);
    expect(res.status).toBe(200);
    expect(mockAI.run).toHaveBeenCalledOnce();
  });

  it('uses OpenRouter when AI_PROVIDER is "openrouter"', async () => {
    fetchSpy.mockResolvedValueOnce(okStreamResponse());
    const env: AIEnv = { OPENROUTER_API_KEY: 'key', AI_PROVIDER: 'openrouter' };

    const res = await streamAIResponse([userMsg], env);
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('returns 503 when "openrouter" is selected but no API key is configured', async () => {
    const env: AIEnv = { AI_PROVIDER: 'openrouter' };

    const res = await streamAIResponse([userMsg], env);
    expect(res.status).toBe(503);
  });

  it('returns 503 when "cloudflare" is selected but no AI binding is configured', async () => {
    const env: AIEnv = { AI_PROVIDER: 'cloudflare' };

    const res = await streamAIResponse([userMsg], env);
    expect(res.status).toBe(503);
  });

  it('prepends a system prompt automatically', async () => {
    const mockAI = makeAIMock();
    const env: AIEnv = { AI: mockAI, AI_PROVIDER: 'cloudflare' };

    await streamAIResponse([userMsg], env);
    const [, opts] = (mockAI.run as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts.messages[0].role).toBe('system');
  });

  describe('A/B mode (AI_PROVIDER = "ab")', () => {
    it('uses only OpenRouter when Cloudflare AI binding is absent', async () => {
      fetchSpy.mockResolvedValue(okStreamResponse());
      const env: AIEnv = { OPENROUTER_API_KEY: 'key', AI_PROVIDER: 'ab' };

      const res = await streamAIResponse([userMsg], env);
      expect(res.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('uses only Cloudflare AI when OpenRouter API key is absent', async () => {
      const mockAI = makeAIMock();
      const env: AIEnv = { AI: mockAI, AI_PROVIDER: 'ab' };

      const res = await streamAIResponse([userMsg], env);
      expect(res.status).toBe(200);
      expect(mockAI.run).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('randomly routes between providers when both are configured', async () => {
      fetchSpy.mockResolvedValue(okStreamResponse());
      const mockAI = makeAIMock();
      const env: AIEnv = { AI: mockAI, OPENROUTER_API_KEY: 'key', AI_PROVIDER: 'ab' };

      // Force Math.random to return < 0.5 → OpenRouter
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.3);
      await streamAIResponse([userMsg], env);
      expect(fetchSpy).toHaveBeenCalledOnce();

      fetchSpy.mockClear();
      (mockAI.run as ReturnType<typeof vi.fn>).mockClear();

      // Force Math.random to return >= 0.5 → Cloudflare
      vi.spyOn(Math, 'random').mockReturnValueOnce(0.7);
      await streamAIResponse([userMsg], env);
      expect(mockAI.run).toHaveBeenCalledOnce();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
