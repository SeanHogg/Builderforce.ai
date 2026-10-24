import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('asks a native engine for its support record before any download (it has no wasm to compile)', async () => {
    const { module } = fakeBfi(streaming);
    const loadBfi = vi.fn(async () => module);
    const engine = createBfiEngine({ loadBfi, store: fakeStore([]), supportFromEngine: true });
    expect(await engine.support()).toBe(gpu);
    expect(module.BfiEngine.support).toHaveBeenCalledTimes(1);
    // The probe still answers nothing to serve until a model is downloaded.
    expect(await engine.probe()).toBeNull();
    expect(module.BfiEngine.create).not.toHaveBeenCalled();
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

describe('bfi without WebGPU (the CPU backend)', () => {
  const GIB = 1024 ** 3;
  const cpuOnly = (deviceMemoryBytes?: number): LocalDeviceSupport => ({
    supported: false,
    reason: 'navigator.gpu is missing',
    f16: false,
    maxBufferBytes: 0,
    backends: {
      cpu: {
        supported: true,
        simd: true,
        threads: 1,
        kvBudgetBytes: 512 * 1024 ** 2,
        maxMemoryBytes: 4 * GIB,
        ...(deviceMemoryBytes ? { deviceMemoryBytes } : {}),
      },
    },
  });
  const cpuModule = (support: LocalDeviceSupport) => {
    const { module } = fakeBfi(streaming);
    module.BfiEngine.support = vi.fn(async () => support);
    module.BfiEngine.contextFor = vi.fn((shape: BfiContextShape) => (shape.backend === 'cpu' ? 2304 : 9216));
    return module;
  };

  it('offers a downloaded Bonsai on the CPU, with the CPU context, never downloading', async () => {
    const module = cpuModule(cpuOnly());
    const store = fakeStore([`local/bfi/${BONSAI}`]);
    const engine = createBfiEngine({ loadBfi: async () => module, store });
    const probe = await engine.probe();
    expect(probe?.models.map((m) => [m.model, m.contextTokens])).toEqual([[BONSAI, 2304]]);
    expect(module.BfiEngine.contextFor).toHaveBeenCalledWith({
      layers: 28,
      kvHeads: 8,
      headDim: 128,
      trainedContext: 32_768,
      backend: 'cpu',
      kvBudgetBytes: 512 * 1024 ** 2,
    });
    expect(module.BfiEngine.create).not.toHaveBeenCalled();
    expect(store.open).not.toHaveBeenCalled();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('does not offer 8B on the CPU of a phone that does not report its memory; a host may supply it', async () => {
    const eight = 'local/bfi/bonsai-8b-q1_0';
    // An unreported RAM is assumed small only on a phone (desktops assume 8 GiB).
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148' });
    const unreported = createBfiEngine({ loadBfi: async () => cpuModule(cpuOnly()), store: fakeStore([eight]) });
    expect(await unreported.probe()).toBeNull();
    const host = createBfiEngine({
      loadBfi: async () => cpuModule(cpuOnly()),
      store: fakeStore([eight]),
      deviceMemoryBytes: 16 * GIB,
    });
    expect((await host.probe())?.models.map((m) => m.model)).toEqual(['bonsai-8b-q1_0']);
    expect((await host.support()).backends?.cpu?.deviceMemoryBytes).toBe(16 * GIB);
  });

  it('maps cpu_memory_exceeded to a 503 the failover routes around', async () => {
    const { module, instance } = fakeBfi(streaming);
    module.BfiEngine.support = vi.fn(async () => cpuOnly());
    instance.load.mockRejectedValueOnce(new Error('cpu_memory_exceeded: weights + KV over 4 GiB'));
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    const res = await pageEnginesFetch([engine])(CHAT_URL, post({ model: BONSAI, messages: [{ role: 'user', content: 'hi' }] }));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('cpu_memory_exceeded');
  });
});

describe('bfi — one queue per engine (loads, evictions and streams never overlap)', () => {
  const GIB = 1024 ** 3;
  const both = (gpuOn: boolean): LocalDeviceSupport => ({
    supported: gpuOn,
    f16: false,
    maxBufferBytes: gpuOn ? 2 ** 28 : 0,
    backends: { cpu: { supported: true, simd: true, threads: 1, kvBudgetBytes: 512 * 1024 ** 2, maxMemoryBytes: 4 * GIB, deviceMemoryBytes: 16 * GIB } },
  });

  it('a CPU turn arriving during a GPU stream waits for it to finish, then evicts the GPU model', async () => {
    const events: string[] = [];
    let finishGpu!: () => void;
    const gpuDone = new Promise<void>((resolve) => (finishGpu = resolve));
    const instance = (backend: string): BfiEngineInstance => ({
      load: vi.fn(async () => {
        events.push(`${backend}:load`);
        return { arch: 'qwen3', contextTokens: 2048, vocab: 1, params: 1 };
      }),
      chat: vi.fn(async (_json: string, onChunk: (chunk: string) => void) => {
        onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: backend }, finish_reason: null }] }));
        if (backend === 'webgpu') await gpuDone;
        events.push(`${backend}:done`);
        return JSON.stringify({ choices: [{ finish_reason: 'stop' }] });
      }),
      unload: vi.fn(() => void events.push(`${backend}:unload`)),
    });
    let gpuOn = true;
    const module: BfiModule = {
      BfiEngine: {
        create: vi.fn(async (o?: { backend?: string }) => instance(o?.backend ?? 'auto')),
        support: vi.fn(async () => both(gpuOn)),
        contextFor: vi.fn(() => 2048),
      },
    };
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    const shim = pageEnginesFetch([engine]);
    const gpu = await shim(CHAT_URL, post({ model: BONSAI, messages: [{ role: 'user', content: 'a' }], stream: true }));
    expect(gpu.status).toBe(200);
    gpuOn = false; // the next turn's fit lands on the CPU
    const cpu = shim(CHAT_URL, post({ model: BONSAI, messages: [{ role: 'user', content: 'b' }], stream: true }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events).toEqual(['webgpu:load']);
    finishGpu();
    expect(await gpu.text()).toContain('"content":"webgpu"');
    expect(await (await cpu).text()).toContain('"content":"cpu"');
    expect(events).toEqual(['webgpu:load', 'webgpu:done', 'webgpu:unload', 'cpu:load', 'cpu:done']);
  });

  it('a turn waiting in the queue leaves it when its caller aborts', async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const { module, instance } = fakeBfi(async (_json, onChunk) => {
      onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] }));
      await held;
      return JSON.stringify({ choices: [{ finish_reason: 'stop' }] });
    });
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    const shim = pageEnginesFetch([engine]);
    const first = await shim(CHAT_URL, post({ model: BONSAI, messages: [], stream: true }));
    const controller = new AbortController();
    const waiting = shim(CHAT_URL, { ...post({ model: BONSAI, messages: [], stream: true }), signal: controller.signal });
    waiting.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10)); // now queued behind the first stream
    controller.abort();
    await expect(waiting).rejects.toBeDefined();
    finish();
    await first.text();
    expect(instance.chat).toHaveBeenCalledTimes(1);
  });
});

describe('bfi — failures', () => {
  it('cancels the store stream when a load fails', async () => {
    const cancel = vi.fn();
    const store = {
      status: vi.fn(async () => 'ready' as const),
      open: vi.fn(async () => ({ stream: new ReadableStream<Uint8Array>({ cancel }), bytes: 42 })),
    };
    const { module, instance } = fakeBfi(streaming);
    instance.load.mockRejectedValueOnce(new Error('load_failed: bad header'));
    const engine = createBfiEngine({ loadBfi: async () => module, store });
    const res = await pageEnginesFetch([engine])(CHAT_URL, post({ model: BONSAI, messages: [], stream: true }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalled();
  });

  it('a lost GPU drops (and disposes) that engine, so the next turn opens a fresh one against a fresh device record', async () => {
    const { module, instance } = fakeBfi(streaming);
    const dispose = vi.fn();
    Object.assign(instance, { dispose });
    instance.chat.mockRejectedValueOnce(new Error('webgpu_unavailable: the GPU device was lost (Unknown); create a new BfiEngine'));
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]) });
    const fetchFn = pageEnginesFetch([engine]);
    const body = post({ model: BONSAI, messages: [{ role: 'user', content: 'x' }], stream: true });
    expect((await fetchFn(CHAT_URL, body)).status).toBe(503);
    expect(dispose).toHaveBeenCalledTimes(1);
    const supportReads = vi.mocked(module.BfiEngine.support).mock.calls.length;
    const again = await fetchFn(CHAT_URL, body);
    expect(again.status).toBe(200);
    await again.text();
    expect(module.BfiEngine.create).toHaveBeenCalledTimes(2);
    expect(vi.mocked(module.BfiEngine.support).mock.calls.length).toBeGreaterThan(supportReads);
  });

  it('a trap ends the turn with bfi_engine_crashed and reports it ONCE to the host, which replaces the worker', async () => {
    const trap = Object.assign(new Error('unreachable'), { name: 'RuntimeError' });
    const { module } = fakeBfi(async () => {
      throw trap;
    });
    const onTrap = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]), onTrap });
    const res = await pageEnginesFetch([engine])(CHAT_URL, post({ model: BONSAI, messages: [], stream: true }));
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('bfi_engine_crashed');
    expect(onTrap).toHaveBeenCalledTimes(1);
    expect(onTrap).toHaveBeenCalledWith(trap);
    warn.mockRestore();
  });

  it('support() — the picker — is never restricted to the backends this host serves; the probe is', async () => {
    const GIB = 1024 ** 3;
    const { module } = fakeBfi(streaming);
    module.BfiEngine.support = vi.fn(async () => ({
      supported: false,
      reason: 'no adapter',
      f16: false,
      maxBufferBytes: 0,
      backends: { cpu: { supported: true, simd: true, threads: 1, kvBudgetBytes: 512 * 1024 ** 2, maxMemoryBytes: 4 * GIB, deviceMemoryBytes: 16 * GIB } },
    }));
    const engine = createBfiEngine({ loadBfi: async () => module, store: fakeStore([`local/bfi/${BONSAI}`]), backends: ['webgpu'] });
    expect((await engine.support()).backends?.cpu?.supported).toBe(true);
    expect(await engine.probe({ fresh: true })).toBeNull();
  });
});
