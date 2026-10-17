import { describe, expect, it, vi } from 'vitest';
import { WEBLLM_ENGINE_BASE_URL, type LocalDeviceSupport } from '@builderforce/local-inference';
import { pageEnginesFetch } from './fetchShim';
import type { ChatCompletionChunk } from './types';
import { WEBLLM_MODEL_CACHE, createWebLlmEngine, type WebLlmEngineLike, type WebLlmModule } from './webllmEngine';

/**
 * WebLLM as a page engine, against a fake `@mlc-ai/web-llm`. Load-bearing:
 *
 *  - a probe NEVER downloads, and does not even import the library when WebLLM has never
 *    cached anything;
 *  - a chat call for a model that is not cached is a 503 before anything streams — only
 *    `models.download` fetches weights;
 *  - `tools` reach only a function-calling build; WebLLM gets one leading system message
 *    and string content.
 */

const CHAT_URL = `${WEBLLM_ENGINE_BASE_URL}/v1/chat/completions`;
const QWEN = 'Qwen3-1.7B-q4f16_1-MLC';
const HERMES = 'Hermes-3-Llama-3.1-8B-q4f16_1-MLC';
const gpu: LocalDeviceSupport = { supported: true, f16: true, maxBufferBytes: 2 ** 30 };

async function* reply(): AsyncGenerator<ChatCompletionChunk> {
  yield { choices: [{ index: 0, delta: { content: 'hi' }, finish_reason: null }] };
  yield { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
}

function fakeWebLlm(cached: string[]) {
  const engines: Array<WebLlmEngineLike & { reload: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> }> = [];
  class MLCEngine {
    progress?: (r: { progress: number }) => void;
    reload = vi.fn(async (modelId: string) => {
      this.progress?.({ progress: 0.5 });
      this.progress?.({ progress: 1 });
      if (!cached.includes(modelId)) cached.push(modelId);
    });
    setInitProgressCallback = (cb: (r: { progress: number }) => void) => {
      this.progress = cb;
    };
    interruptGenerate = vi.fn();
    unload = vi.fn(async () => undefined);
    create = vi.fn(async (_request: Record<string, unknown>) => reply());
    chat = { completions: { create: this.create } };
    constructor() {
      engines.push(this as never);
    }
  }
  const module: WebLlmModule = {
    MLCEngine: MLCEngine as never,
    WebWorkerMLCEngine: MLCEngine as never,
    hasModelInCache: vi.fn(async (id: string) => cached.includes(id)),
    deleteModelAllInfoInCache: vi.fn(async (id: string) => {
      cached.splice(cached.indexOf(id), 1);
    }),
  };
  return { module, engines };
}

function setup(options: { cached?: string[]; bucket?: boolean; support?: LocalDeviceSupport } = {}) {
  const { module, engines } = fakeWebLlm(options.cached ?? []);
  const loadWebLlm = vi.fn(async () => module);
  const caches = { has: vi.fn(async (name: string) => name === WEBLLM_MODEL_CACHE && (options.bucket ?? true)) };
  const engine = createWebLlmEngine({ loadWebLlm, caches, support: async () => options.support ?? gpu });
  return { engine, module, engines, loadWebLlm, fetch: pageEnginesFetch([engine]) };
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

describe('webllm probe', () => {
  it('does not import WebLLM at all when it has never cached a model', async () => {
    const { engine, loadWebLlm } = setup({ bucket: false });
    expect(await engine.probe()).toBeNull();
    expect(loadWebLlm).not.toHaveBeenCalled();
  });

  it('lists only the cached catalog models this device can run, never downloading', async () => {
    const { engine, engines } = setup({ cached: [QWEN, HERMES], support: { ...gpu, maxBufferBytes: 2 ** 27 } });
    const probe = await engine.probe();
    expect(probe).toEqual({
      provider: 'webllm',
      endpoint: { baseUrl: WEBLLM_ENGINE_BASE_URL },
      reachable: true,
      models: [{ ref: `local/webllm/${QWEN}`, provider: 'webllm', model: QWEN, label: 'Qwen3 1.7B', tools: false, contextTokens: 4096 }],
    });
    expect(engines).toHaveLength(0);
  });

  it('is null without WebGPU', async () => {
    const { engine } = setup({ cached: [QWEN], support: { supported: false, f16: false, maxBufferBytes: 0 } });
    expect(await engine.probe()).toBeNull();
  });
});

describe('webllm chat', () => {
  it('serves a cached model, merging system messages and flattening text parts', async () => {
    const { fetch, engines } = setup({ cached: [QWEN] });
    const res = await fetch(
      CHAT_URL,
      post({
        model: QWEN,
        stream: false,
        routingMode: 'auto',
        messages: [
          { role: 'system', content: 'A' },
          { role: 'user', content: [{ type: 'text', text: 'hello' }] },
          { role: 'system', content: 'B' },
        ],
      }),
    );
    expect(await res.json()).toMatchObject({ choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }] });
    expect(engines[0]!.reload).toHaveBeenCalledWith(QWEN);
    const request = engines[0]!.create.mock.calls[0]![0];
    expect(request).toEqual({
      messages: [
        { role: 'system', content: 'A\n\nB' },
        { role: 'user', content: 'hello' },
      ],
      stream: true,
      stream_options: { include_usage: true },
    });
  });

  it('refuses before streaming: not downloaded 503, unknown 404, tools on a non-calling build 400', async () => {
    const { fetch, engines } = setup({ cached: [] });
    const user = [{ role: 'user', content: 'x' }];
    expect((await fetch(CHAT_URL, post({ model: QWEN, messages: user, stream: true }))).status).toBe(503);
    expect((await fetch(CHAT_URL, post({ model: 'nope', messages: user, stream: true }))).status).toBe(404);
    const tools = [{ type: 'function', function: { name: 't', parameters: {} } }];
    expect((await fetch(CHAT_URL, post({ model: QWEN, messages: user, tools, stream: true }))).status).toBe(400);
    // Nothing was loaded — let alone downloaded — to answer any of them.
    expect(engines).toHaveLength(0);
  });

  it('forwards tools to a function-calling build', async () => {
    const { fetch, engines } = setup({ cached: [HERMES] });
    const tools = [{ type: 'function', function: { name: 't', parameters: {} } }];
    const res = await fetch(CHAT_URL, post({ model: HERMES, messages: [{ role: 'user', content: 'x' }], tools, stream: true }));
    expect(res.status).toBe(200);
    await res.text();
    expect(engines[0]!.create.mock.calls[0]![0]).toMatchObject({ tools });
  });
});

describe('webllm models', () => {
  it('downloads by loading with progress, then probes the model as ready', async () => {
    const { engine, engines } = setup({ cached: [] });
    expect(await engine.probe()).toBeNull();
    const progress: number[] = [];
    await engine.models.download(QWEN, (f) => progress.push(f));
    expect(progress).toEqual([0.5, 1, 1]);
    expect(engines[0]!.reload).toHaveBeenCalledWith(QWEN);
    expect((await engine.probe())?.models.map((m) => m.model)).toEqual([QWEN]);
  });

  it('removes through WebLLM cache APIs and unloads a resident model', async () => {
    const { engine, engines, module } = setup({ cached: [] });
    await engine.models.download(QWEN);
    await engine.models.remove(QWEN);
    expect(engines[0]!.unload).toHaveBeenCalled();
    expect(module.deleteModelAllInfoInCache).toHaveBeenCalledWith(QWEN);
    expect(await engine.models.has(QWEN)).toBe(false);
  });
});
