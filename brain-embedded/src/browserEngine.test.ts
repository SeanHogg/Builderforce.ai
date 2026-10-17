import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_ENGINE_BASE_URL, type LocalRuntimeProbe } from '@builderforce/local-inference';
import type { BrainStreamFn } from './brainRunStore';
import {
  BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS,
  createBrowserEngineProber,
  promptApiEngine,
  toPromptApiTurn,
} from './browserEngine';
import { createLocalFirstStream, localTransport } from './localFirstTransport';
import { pageEnginesFetch } from './pageEngines/fetchShim';
import { streamChatCompletion } from './streamChatCompletion';

/**
 * The browser's own model as a local-first runtime. Load-bearing:
 *
 *  - readiness is asked WITHOUT a download: `downloadable`/`downloading` is not offered;
 *  - the in-page route speaks exactly the SSE the shared streamer parses, so a browser
 *    turn is indistinguishable from an Ollama one to the loop;
 *  - every refusal (tools, oversized, unavailable, a failure before the first delta) is
 *    a non-2xx, so the failover reaches the gateway before the user saw anything.
 */

const CHAT_URL = `${BROWSER_ENGINE_BASE_URL}/v1/chat/completions`;
/** The Prompt API engine behind the ONE page shim — what every host lends the streamer. */
const browserEngineFetch = (base?: (input: string, init: RequestInit) => Promise<Response>) =>
  pageEnginesFetch([promptApiEngine], base);

type FakeSession = {
  inputQuota?: number;
  inputUsage: number;
  destroy: ReturnType<typeof vi.fn>;
  measureInputUsage: ReturnType<typeof vi.fn>;
  promptStreaming: ReturnType<typeof vi.fn>;
  prompt: ReturnType<typeof vi.fn>;
  clone: ReturnType<typeof vi.fn>;
};

const streamOf = (chunks: readonly string[]): ReadableStream<string> =>
  new ReadableStream<string>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });

function installLanguageModel(options: {
  availability?: string;
  chunks?: string[];
  quota?: number;
  failCreate?: Error;
  stream?: (signal: AbortSignal | undefined) => ReadableStream<string>;
} = {}) {
  const sessions: FakeSession[] = [];
  const factory = {
    availability: vi.fn(async () => options.availability ?? 'available'),
    create: vi.fn(async (_init?: unknown) => {
      if (options.failCreate) throw options.failCreate;
      const session: FakeSession = {
        inputQuota: options.quota ?? 6_144,
        inputUsage: 0,
        destroy: vi.fn(),
        measureInputUsage: vi.fn(async (input: string) => input.length),
        promptStreaming: vi.fn((_input: string, opts?: { signal?: AbortSignal }) =>
          options.stream ? options.stream(opts?.signal) : streamOf(options.chunks ?? ['Hel', 'lo'])),
        prompt: vi.fn(),
        clone: vi.fn(),
      };
      sessions.push(session);
      return session;
    }),
  };
  (globalThis as { LanguageModel?: unknown }).LanguageModel = factory;
  return { factory, sessions };
}

const passthrough = vi.fn(async (_input: string, _init: RequestInit) => new Response('base', { status: 200 }));

afterEach(() => {
  delete (globalThis as { LanguageModel?: unknown }).LanguageModel;
  delete (globalThis as { ai?: unknown }).ai;
  passthrough.mockClear();
  vi.restoreAllMocks();
});
const transport = () => localTransport({ baseUrl: BROWSER_ENGINE_BASE_URL }, browserEngineFetch(passthrough));
const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

describe('the Prompt API engine probe', () => {
  it('offers the one model only when it is ready, with the session quota as its window', async () => {
    const { factory, sessions } = installLanguageModel({ quota: 9_216 });
    const probe = await createBrowserEngineProber().probe();
    expect(probe).toEqual({
      provider: 'browser',
      endpoint: { baseUrl: BROWSER_ENGINE_BASE_URL },
      reachable: true,
      models: [
        {
          ref: 'local/browser/gemini-nano',
          provider: 'browser',
          model: 'gemini-nano',
          label: 'Gemini Nano',
          tools: false,
          contextTokens: 9_216,
        },
      ],
    });
    // The quota came from a throwaway session that was released at once.
    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(sessions[0]!.destroy).toHaveBeenCalled();
  });

  it('never offers a model that would have to download first', async () => {
    for (const availability of ['downloadable', 'downloading', 'unavailable']) {
      const { factory } = installLanguageModel({ availability });
      expect(await createBrowserEngineProber().probe(), availability).toBeNull();
      // Asking never creates a session — create() is what starts a download.
      expect(factory.create).not.toHaveBeenCalled();
    }
  });

  it('is null without the Prompt API, and reads the legacy surface when that is all there is', async () => {
    expect(await createBrowserEngineProber().probe()).toBeNull();
    (globalThis as { ai?: unknown }).ai = {
      languageModel: {
        capabilities: async () => ({ available: 'readily' }),
        create: async () => ({ destroy: () => undefined }),
      },
    };
    const probe = await createBrowserEngineProber().probe();
    expect(probe?.models[0]?.contextTokens).toBe(BROWSER_ENGINE_FALLBACK_CONTEXT_TOKENS);
  });

  it('asks the browser once per TTL, again when fresh or expired', async () => {
    const { factory } = installLanguageModel();
    let now = 0;
    const prober = createBrowserEngineProber({ ttlMs: 1_000, now: () => now });
    await prober.probe();
    await prober.probe();
    expect(factory.availability).toHaveBeenCalledTimes(1);
    await prober.probe({ fresh: true });
    now = 5_000;
    await prober.probe();
    expect(factory.availability).toHaveBeenCalledTimes(3);
    // The quota is a property of the installed model — learned once.
    expect(factory.create).toHaveBeenCalledTimes(1);
  });
});

describe('toPromptApiTurn', () => {
  it('seeds system and prior turns, and prompts with the last user message', () => {
    expect(
      toPromptApiTurn([
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: [{ type: 'text', text: 'and now?' }] },
      ]),
    ).toEqual({
      initialPrompts: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      prompt: 'and now?',
    });
  });

  it('refuses what the built-in model cannot read', () => {
    expect(toPromptApiTurn([])).toEqual({ error: 'no_messages' });
    expect(toPromptApiTurn([{ role: 'tool', content: 'x', tool_call_id: '1' }])).toEqual({ error: 'tool_messages_unsupported' });
    expect(toPromptApiTurn([{ role: 'assistant', content: '', tool_calls: [{ id: '1' }] }])).toEqual({ error: 'tool_messages_unsupported' });
    expect(toPromptApiTurn([{ role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:' } }] }])).toEqual({
      error: 'non_text_content_unsupported',
    });
    expect(toPromptApiTurn([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'a' }])).toEqual({
      error: 'last_message_not_user',
    });
  });
});

describe('the Prompt API engine behind pageEnginesFetch', () => {
  it('passes every other request to the base fetch', async () => {
    installLanguageModel();
    const res = await browserEngineFetch(passthrough)('http://127.0.0.1:11434/v1/chat/completions', post({}));
    expect(await res.text()).toBe('base');
  });

  it('answers the chat route as SSE the shared streamer parses', async () => {
    const { factory, sessions } = installLanguageModel({ chunks: ['Hel', 'lo', ' world'] });
    const result = await streamChatCompletion({
      transport: transport(),
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hey' },
        { role: 'user', content: 'say hello' },
      ],
    });
    expect(result.text).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    expect(factory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        initialPrompts: [
          { role: 'system', content: 'Be brief.' },
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: 'hey' },
        ],
      }),
    );
    expect(sessions[0]!.promptStreaming.mock.calls[0]![0]).toBe('say hello');
    expect(sessions[0]!.destroy).toHaveBeenCalled();
    expect(passthrough).not.toHaveBeenCalled();
  });

  it('normalises cumulative chunks from older builds into deltas', async () => {
    installLanguageModel({ chunks: ['Hel', 'Hello', 'Hello world'] });
    const result = await streamChatCompletion({ transport: transport(), messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('Hello world');
  });

  it('answers a non-streaming request with one completion', async () => {
    installLanguageModel();
    const res = await browserEngineFetch()(CHAT_URL, post({ messages: [{ role: 'user', content: 'x' }], stream: false }));
    expect(await res.json()).toMatchObject({ choices: [{ message: { role: 'assistant', content: 'Hello' } }] });
  });

  it('refuses with a non-2xx before anything streams', async () => {
    const msg = { messages: [{ role: 'user', content: 'x' }], stream: true };
    installLanguageModel();
    expect((await browserEngineFetch()(CHAT_URL, post({ ...msg, tools: [{ type: 'function' }] }))).status).toBe(400);

    installLanguageModel({ availability: 'downloadable' });
    expect((await browserEngineFetch()(CHAT_URL, post(msg))).status).toBe(503);

    installLanguageModel({ failCreate: Object.assign(new Error('too long'), { name: 'QuotaExceededError' }) });
    expect((await browserEngineFetch()(CHAT_URL, post(msg))).status).toBe(413);

    const { sessions } = installLanguageModel({ quota: 3 });
    expect((await browserEngineFetch()(CHAT_URL, post({ ...msg, messages: [{ role: 'user', content: 'too long' }] }))).status).toBe(413);
    expect(sessions[0]!.promptStreaming).not.toHaveBeenCalled();
    expect(sessions[0]!.destroy).toHaveBeenCalled();

    installLanguageModel({
      stream: () =>
        new ReadableStream<string>({
          start(controller) {
            controller.error(new Error('model crashed'));
          },
        }),
    });
    expect((await browserEngineFetch()(CHAT_URL, post(msg))).status).toBe(500);
  });

  it('stops on the request signal and releases the session', async () => {
    const { sessions } = installLanguageModel({
      stream: (signal) =>
        new ReadableStream<string>({
          start(controller) {
            controller.enqueue('Hel');
            signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
          },
        }),
    });
    const abort = new AbortController();
    const run = streamChatCompletion(
      { transport: transport(), messages: [{ role: 'user', content: 'x' }], signal: abort.signal },
      { onTextDelta: () => abort.abort() },
    );
    await expect(run).rejects.toThrow();
    expect(sessions[0]!.destroy).toHaveBeenCalled();
  });
});

describe('local first on the browser engine', () => {
  const page = async (): Promise<LocalRuntimeProbe> => (await createBrowserEngineProber().probe())!;
  const cloudAnswer = (text: string) =>
    vi.fn<BrainStreamFn>(async () => ({ text, toolCalls: [], finishReason: 'stop', resolvedModel: 'cloud/model' }));

  it('serves a tool-free turn in the page and names it as the local ref', async () => {
    installLanguageModel();
    const cloud = cloudAnswer('from-cloud');
    const stream = createLocalFirstStream({ probes: [await page()], cloud, fetch: browserEngineFetch(passthrough) });
    const result = await stream({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('Hello');
    expect(result.resolvedModel).toBe('local/browser/gemini-nano');
    expect(cloud).not.toHaveBeenCalled();
  });

  it('fails over to the cloud invisibly when the page refuses, and sends tool turns straight there', async () => {
    installLanguageModel({ failCreate: new Error('component crashed') });
    const cloud = cloudAnswer('from-cloud');
    const stream = createLocalFirstStream({ probes: [await page()], cloud, fetch: browserEngineFetch(passthrough) });
    expect((await stream({ messages: [{ role: 'user', content: 'x' }] })).text).toBe('from-cloud');

    const { factory } = installLanguageModel();
    const tools = [{ type: 'function' as const, function: { name: 't', description: 'd', parameters: {} } }];
    expect((await stream({ messages: [{ role: 'user', content: 'x' }], tools })).text).toBe('from-cloud');
    expect(factory.create).not.toHaveBeenCalled();
  });
});
