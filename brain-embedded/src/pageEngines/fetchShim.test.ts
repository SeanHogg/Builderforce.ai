import { describe, expect, it, vi } from 'vitest';
import { WEBLLM_ENGINE_BASE_URL, type LocalRuntimeProbe } from '@builderforce/local-inference';
import { localTransport } from '../localFirstTransport';
import { streamChatCompletion } from '../streamChatCompletion';
import { pageEnginesFetch, probePageEngines } from './fetchShim';
import { PageEngineError, type ChatCompletionChunk, type PageEngine } from './types';

/**
 * THE page shim. Load-bearing for every page engine at once:
 *
 *  - SSE exactly as the shared streamer parses it, closed by `[DONE]`;
 *  - a failure BEFORE the first chunk is a non-2xx (the failover's cue), with the
 *    engine's own status when it gave one;
 *  - a failure AFTER it is an in-band error frame (the turn is committed);
 *  - an abort is re-thrown, never answered; a non-streaming call is one folded completion.
 */

const CHAT_URL = `${WEBLLM_ENGINE_BASE_URL}/v1/chat/completions`;

const text = (content: string, finish: string | null = null): ChatCompletionChunk => ({
  choices: [{ index: 0, delta: { content }, finish_reason: finish }],
});

async function* chunks(list: readonly ChatCompletionChunk[], failAfter?: Error) {
  for (const c of list) yield c;
  if (failAfter) throw failAfter;
}

function fakeEngine(chat: PageEngine['chatCompletions'], probe: LocalRuntimeProbe | null = null): PageEngine {
  return {
    runtime: 'webllm',
    baseUrl: WEBLLM_ENGINE_BASE_URL,
    probe: vi.fn(async () => probe),
    invalidate: vi.fn(),
    chatCompletions: vi.fn(chat),
  };
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});
const msg = { model: 'm', messages: [{ role: 'user', content: 'x' }], stream: true };

describe('pageEnginesFetch', () => {
  it('passes every request that is not an engine chat route to the base fetch', async () => {
    const base = vi.fn(async () => new Response('base'));
    const fetch = pageEnginesFetch([fakeEngine(async () => chunks([]))], base);
    expect(await (await fetch('http://127.0.0.1:11434/v1/chat/completions', post(msg))).text()).toBe('base');
    expect(await (await fetch(CHAT_URL, { method: 'GET' })).text()).toBe('base');
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('serves the chunks as SSE the shared streamer parses, tool calls included', async () => {
    const engine = fakeEngine(async () =>
      chunks([
        text('Hel'),
        text('lo'),
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'read', arguments: '{"p":' } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, finish_reason: 'tool_calls' }] },
      ]),
    );
    const transport = localTransport({ baseUrl: WEBLLM_ENGINE_BASE_URL }, pageEnginesFetch([engine]));
    const result = await streamChatCompletion({ transport, model: 'm', messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('Hello');
    expect(result.toolCalls).toEqual([{ id: 'c1', name: 'read', args: '{"p":1}' }]);
    expect(result.finishReason).toBe('tool_calls');
  });

  it('ends the body with [DONE]', async () => {
    const res = await pageEnginesFetch([fakeEngine(async () => chunks([text('a', 'stop')]))])(CHAT_URL, post(msg));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toMatch(/data: \[DONE\]\n\n$/);
  });

  it('answers a refusal before anything streams with the engine status', async () => {
    const refusing = fakeEngine(async () => {
      throw new PageEngineError(503, 'model_not_downloaded');
    });
    const res = await pageEnginesFetch([refusing])(CHAT_URL, post(msg));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: { code: 'model_not_downloaded', message: 'model_not_downloaded' } });
  });

  it('answers a failure on the first pull as a 500 named for the runtime', async () => {
    const res = await pageEnginesFetch([fakeEngine(async () => chunks([], new Error('gpu lost')))])(CHAT_URL, post(msg));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'webllm_engine_failed', message: 'gpu lost' } });
  });

  it('refuses a body that is not JSON', async () => {
    const res = await pageEnginesFetch([fakeEngine(async () => chunks([]))])(CHAT_URL, { method: 'POST', body: '{' });
    expect(res.status).toBe(400);
  });

  it('reports a failure after the first chunk in-band, never as a status', async () => {
    const res = await pageEnginesFetch([fakeEngine(async () => chunks([text('Hel')], new Error('device lost')))])(
      CHAT_URL,
      post(msg),
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('"content":"Hel"');
    expect(body).toContain('"error":{"message":"device lost"}');
  });

  it('re-throws an abort instead of answering it', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetch = pageEnginesFetch([fakeEngine(async () => chunks([text('a')]))]);
    await expect(fetch(CHAT_URL, post(msg, abort.signal))).rejects.toBeDefined();
  });

  it('returns the engine iterator when the body is cancelled', async () => {
    const returned = vi.fn();
    const iterable: AsyncIterable<ChatCompletionChunk> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: text('more') }),
        return: async () => {
          returned();
          return { done: true, value: undefined };
        },
      }),
    };
    const res = await pageEnginesFetch([fakeEngine(async () => iterable)])(CHAT_URL, post(msg));
    await res.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(returned).toHaveBeenCalled();
  });

  it('folds a non-streaming request into one completion', async () => {
    const engine = fakeEngine(async () =>
      chunks([
        text('Hi '),
        text('there', 'stop'),
        { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } },
      ]),
    );
    const res = await pageEnginesFetch([engine])(CHAT_URL, post({ ...msg, stream: false }));
    expect(await res.json()).toEqual({
      object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hi there' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    });
  });
});

describe('probePageEngines', () => {
  it('keeps only engines with something to serve, and never lets one failure sink the rest', async () => {
    const ready: LocalRuntimeProbe = { provider: 'webllm', endpoint: { baseUrl: WEBLLM_ENGINE_BASE_URL }, reachable: true, models: [] };
    const broken = fakeEngine(async () => chunks([]));
    broken.probe = vi.fn(async () => {
      throw new Error('boom');
    });
    const probes = await probePageEngines([fakeEngine(async () => chunks([]), ready), fakeEngine(async () => chunks([])), broken]);
    expect(probes).toEqual([ready]);
  });
});
