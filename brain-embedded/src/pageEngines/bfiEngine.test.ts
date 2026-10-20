import { describe, expect, it, vi } from 'vitest';
import { BFI_ENGINE_BASE_URL, type LocalDeviceSupport } from '@builderforce/local-inference';
import { localTransport } from '../localFirstTransport';
import { streamChatCompletion } from '../streamChatCompletion';
import { createBfiEngine, type BfiContextShape, type BfiEngineInstance, type BfiModule } from './bfiEngine';
import { pageEnginesFetch } from './fetchShim';
import type { HfModelStore } from './hfModelStore';

/**
 * The WebGPU `bfi` engine against a fake `bfi-web` (PRD 34 §3.1). Load-bearing:
 *
 *  - a probe looks in the model store first and never loads the wasm when no Bonsai file
 *    is downloaded — and never downloads;
 *  - the callback stream becomes OpenAI SSE, closed by the completion's finish reason;
 *  - `bfi-web`'s `<code>: detail` rejections map to failover statuses before the first
 *    chunk; a model not in the store is a 503.
 */

const CHAT_URL = `${BFI_ENGINE_BASE_URL}/v1/chat/completions`;
const BONSAI = 'bonsai-1.7b-q1_0';
const gpu: LocalDeviceSupport = { supported: true, f16: false, maxBufferBytes: 2 ** 28 };

function fakeStore(ready: string[]): Pick<HfModelStore, 'status' | 'open'> & { open: ReturnType<typeof vi.fn> } {
  return {
    status: vi.fn(async (ref: string) => (ready.includes(ref) ? ('ready' as const) : ('absent' as const))),
    open: vi.fn(async () => ({ stream: new ReadableStream<Uint8Array>(), bytes: 42 })),
  };
}

function fakeBfi(chat: BfiEngineInstance['chat'], create?: () => Promise<BfiEngineInstance>) {
  const instance: BfiEngineInstance & { load: ReturnType<typeof vi.fn> } = {
    load: vi.fn(async () => ({ arch: 'qwen3', contextTokens: 8192, vocab: 151669, params: 1.7e9 })),
    chat: vi.fn(chat),
    unload: vi.fn(),
  };
  const module: BfiModule = {
    BfiEngine: {
      create: vi.fn(create ?? (async () => instance)),
      support: vi.fn(async () => gpu),
      contextFor: vi.fn((shape: BfiContextShape) => (shape.f16 ? 18688 : 9216)),
    },
  };
  return { module, instance };
}

const streaming: BfiEngineInstance['chat'] = async (_json, onChunk) => {
  onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }] }));
  onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] }));
  return JSON.stringify({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 2 } });
};

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

describe('bfi probe', () => {
  it('never loads the wasm when nothing is downloaded', async () => {
    const loadBfi = vi.fn(async () => fakeBfi(streaming).module);
    const engine = createBfiEngine({ loadBfi, store: fakeStore([]) });
    expect(await engine.probe()).toBeNull();
    expect(loadBfi).not.toHaveBeenCalled();
  });

  it('lists the downloaded Bonsai models as tool-capable, asking support() but creating no device', async () => {
    const { module } = fakeBfi(streaming);
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    expect(await engine.probe()).toEqual({
      provider: 'bfi',
      endpoint: { baseUrl: BFI_ENGINE_BASE_URL },
      reachable: true,
      models: [{ ref: `local/bfi/${BONSAI}`, provider: 'bfi', model: BONSAI, label: 'Bonsai 1.7B (1-bit)', tools: true, contextTokens: 9216 }],
    });
    expect(module.BfiEngine.create).not.toHaveBeenCalled();
  });

  it('reports the context the device will SERVE, planned from the row KV shape, never the trained window', async () => {
    const { module } = fakeBfi(streaming);
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    const probe = await engine.probe();
    expect(probe?.models[0]?.contextTokens).toBe(9216);
    expect(module.BfiEngine.contextFor).toHaveBeenCalledWith({
      layers: 28,
      kvHeads: 8,
      headDim: 128,
      trainedContext: 32768,
      f16: false,
      maxStorageBufferBindingSizeBytes: gpu.maxBufferBytes,
    });
  });

  it('reports what a load actually allocated once the model has been loaded', async () => {
    const { module } = fakeBfi(streaming);
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    expect((await engine.probe())?.models[0]?.contextTokens).toBe(9216);
    const transport = localTransport({ baseUrl: BFI_ENGINE_BASE_URL }, pageEnginesFetch([engine]));
    await streamChatCompletion({ transport, model: BONSAI, messages: [{ role: 'user', content: 'x' }] });
    expect((await engine.probe())?.models[0]?.contextTokens).toBe(8192);
  });

  it('is null when WebGPU is unavailable', async () => {
    const { module } = fakeBfi(streaming);
    module.BfiEngine.support = async () => ({ supported: false, reason: 'no adapter', f16: false, maxBufferBytes: 0 });
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    expect(await engine.probe()).toBeNull();
  });
});

describe('bfi chat', () => {
  it('loads the stored weights once and streams the callback chunks as SSE', async () => {
    const { module, instance } = fakeBfi(streaming);
    const store = fakeStore([`local/bfi/${BONSAI}`]);
    const engine = createBfiEngine({ loadBfi: async () => module, store });
    const transport = localTransport({ baseUrl: BFI_ENGINE_BASE_URL }, pageEnginesFetch([engine]));
    const tools = [{ type: 'function' as const, function: { name: 't', description: 'd', parameters: {} } }];
    for (let i = 0; i < 2; i++) {
      const result = await streamChatCompletion({ transport, model: BONSAI, messages: [{ role: 'user', content: 'x' }], tools });
      expect(result.text).toBe('Hello');
      expect(result.finishReason).toBe('stop');
    }
    expect(instance.load).toHaveBeenCalledTimes(1);
    expect(instance.load.mock.calls[0]![1]).toBe(42);
    expect(store.open).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(vi.mocked(instance.chat).mock.calls[0]![0]);
    expect(sent).toMatchObject({ model: BONSAI, stream: true, tools });
  });

  it('refuses a model not in the store with a 503, before creating anything', async () => {
    const { module } = fakeBfi(streaming);
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([]) });
    const res = await pageEnginesFetch([engine])(CHAT_URL, post({ model: BONSAI, messages: [], stream: true }));
    expect(res.status).toBe(503);
    expect(module.BfiEngine.create).not.toHaveBeenCalled();
  });

  it('maps bfi-web rejections to failover statuses', async () => {
    const noGpu = fakeBfi(streaming, async () => {
      throw new Error('webgpu_unavailable: no adapter');
    });
    const store = fakeStore([`local/bfi/${BONSAI}`]);
    const body = post({ model: BONSAI, messages: [{ role: 'user', content: 'x' }], stream: true });
    const a = await pageEnginesFetch([createBfiEngine({ loadBfi: async () => noGpu.module, store })])(CHAT_URL, body);
    expect(a.status).toBe(503);

    const tooLong = fakeBfi(async () => {
      throw new Error('context_exceeded: 40000 > 32768');
    });
    const b = await pageEnginesFetch([createBfiEngine({ loadBfi: async () => tooLong.module, store })])(CHAT_URL, body);
    expect(b.status).toBe(413);

    const crashed = fakeBfi(async () => {
      throw new Error('kernel panic');
    });
    const c = await pageEnginesFetch([createBfiEngine({ loadBfi: async () => crashed.module, store })])(CHAT_URL, body);
    expect(c.status).toBe(500);
  });

  it('aborts the engine when the consumer stops early', async () => {
    let seen: AbortSignal | undefined;
    const { module } = fakeBfi(
      (_json, onChunk, signal) =>
        new Promise((_resolve, reject) => {
          seen = signal;
          onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'a' }, finish_reason: null }] }));
          signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    const res = await pageEnginesFetch([engine])(CHAT_URL, post({ model: BONSAI, messages: [{ role: 'user', content: 'x' }], stream: true }));
    expect(res.status).toBe(200);
    await res.body!.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen?.aborted).toBe(true);
  });
});
