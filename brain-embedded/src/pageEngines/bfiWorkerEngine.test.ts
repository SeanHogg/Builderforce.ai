import { describe, expect, it, vi } from 'vitest';
import { BFI_ENGINE_BASE_URL, localCatalogModel, localModelFit, type LocalDeviceSupport } from '@builderforce/local-inference';
import type { BfiContextShape, BfiEngineInstance, BfiModule } from './bfiEngine';
import { BfiThreadsError, type BfiThreadsSource } from './bfiLoader';
import { runBfiWorker } from './bfiWorker';
import { createBfiWorkerEngine, type WorkerLike } from './bfiWorkerEngine';
import { ENGINE_WORKER_FATAL } from './remote/engineWorker';
import { pageEnginesFetch } from './fetchShim';

/**
 * `bfi` in a dedicated Web Worker, both halves joined by an in-memory, asynchronous
 * message channel (structured clone in a browser; a microtask hop here). Load-bearing:
 * the page sees an ordinary `bfi` page engine — probe, streamed chunks, refusals with
 * their status, abort, the support record — while the engine itself runs over there.
 */

const BONSAI = 'bonsai-1.7b-q1_0';
const REF = `local/bfi/${BONSAI}`;
const CHAT_URL = `${BFI_ENGINE_BASE_URL}/v1/chat/completions`;
const cpuOnly: LocalDeviceSupport = {
  supported: false,
  reason: 'navigator.gpu is missing',
  f16: false,
  maxBufferBytes: 0,
  backends: { cpu: { supported: true, simd: true, threads: 1, kvBudgetBytes: 2 ** 29, maxMemoryBytes: 2 ** 32 } },
};

type Listener = (event: { data: unknown }) => void;
function endpoint() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    peer: undefined as undefined | { deliver(data: unknown): void },
    deliver(data: unknown) {
      queueMicrotask(() => listeners.get('message')?.forEach((l) => l({ data: structuredClone(data) })));
    },
    addEventListener(type: string, l: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(l);
    },
    removeEventListener(type: string, l: Listener) {
      listeners.get(type)?.delete(l);
    },
    fail() {
      listeners.get('error')?.forEach((l) => l({ data: undefined }));
    },
  };
}

function setup(
  chat: BfiEngineInstance['chat'],
  ready = [REF],
  extra: { idleMs?: number; pageStore?: boolean; threads?: BfiThreadsSource; relay?: boolean } = {},
) {
  const instance: BfiEngineInstance & { load: ReturnType<typeof vi.fn> } = {
    load: vi.fn(async () => ({ arch: 'qwen3', backend: 'cpu' as const, contextTokens: 2304, vocab: 151669, params: 1.7e9 })),
    chat: vi.fn(chat),
    unload: vi.fn(),
  };
  const module: BfiModule = {
    BfiEngine: {
      create: vi.fn(async () => instance),
      support: vi.fn(async () => cpuOnly),
      contextFor: vi.fn((shape: BfiContextShape) => (shape.backend === 'cpu' ? 2304 : 9216)),
    },
  };
  const loadBfi = vi.fn(async (_url: string, _threads?: BfiThreadsSource) => module);
  const store = {
    status: vi.fn(async (ref: string) => (ready.includes(ref) ? ('ready' as const) : ('absent' as const))),
    open: vi.fn(async () => ({ stream: new ReadableStream<Uint8Array>(), bytes: 1 })),
  };
  // With `relay`, the worker must read only through the page: its own store refuses.
  const workerStore = extra.relay
    ? { status: vi.fn(async () => Promise.reject(new Error('worker store used'))), open: vi.fn(async () => Promise.reject(new Error('worker store used'))) }
    : store;
  const inits: unknown[] = [];
  const created: Array<ReturnType<typeof endpoint>> = [];
  const create = vi.fn((): WorkerLike => {
    const page = endpoint();
    const worker = endpoint();
    created.push(page);
    // The worker scope posts to the page; the page's Worker posts to the scope.
    runBfiWorker({ ...worker, postMessage: (m: unknown) => page.deliver(m) }, { store: workerStore, loadBfi });
    return {
      ...page,
      postMessage: (m: unknown) => {
        if ((m as { type?: string }).type === 'bfi.init') inits.push(m);
        worker.deliver(m);
      },
      terminate: vi.fn(),
    } as unknown as WorkerLike;
  });
  const engine = createBfiWorkerEngine({
    create,
    wasmUrl: async () => 'https://app.test/bfi_web_bg.wasm',
    timeoutMs: 1_000,
    ...(extra.idleMs !== undefined ? { idleMs: extra.idleMs } : {}),
    ...(extra.pageStore || extra.relay ? { store } : {}),
    ...(extra.threads ? { threads: () => extra.threads } : {}),
    ...(extra.relay ? { relayStore: true } : {}),
  });
  return { engine, create, created, loadBfi, instance, store, inits };
}

const streaming: BfiEngineInstance['chat'] = async (_json, onChunk) => {
  onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'Hel' }, finish_reason: null }] }));
  onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'lo' }, finish_reason: null }] }));
  return JSON.stringify({ choices: [{ finish_reason: 'stop' }] });
};
const post = (signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  body: JSON.stringify({ model: BONSAI, stream: true, messages: [{ role: 'user', content: 'hi' }] }),
  ...(signal ? { signal } : {}),
});

describe('bfi in a Web Worker', () => {
  it('starts no worker until asked, then probes over it with the CPU context, handing it the wasm URL', async () => {
    const { engine, create, loadBfi } = setup(streaming);
    expect(create).not.toHaveBeenCalled();
    const probe = await engine.probe({ fresh: true });
    expect(create).toHaveBeenCalledTimes(1);
    expect(probe?.models.map((m) => [m.ref, m.contextTokens])).toEqual([[REF, 2304]]);
    expect(loadBfi).toHaveBeenCalledWith('https://app.test/bfi_web_bg.wasm');
    expect((await engine.support()).backends?.cpu?.supported).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('streams the worker engine’s chunks back through the ONE fetch shim', async () => {
    const { engine } = setup(streaming);
    const res = await pageEnginesFetch([engine])(CHAT_URL, post());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"content":"Hel"');
    expect(text).toContain('"content":"lo"');
    expect(text.trim().endsWith('data: [DONE]')).toBe(true);
  });

  it('keeps a refusal’s status across the worker boundary', async () => {
    const { engine, instance } = setup(streaming);
    instance.load.mockRejectedValueOnce(new Error('cpu_memory_exceeded: too big'));
    const res = await pageEnginesFetch([engine])(CHAT_URL, post());
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('cpu_memory_exceeded');
  });

  it('carries an abort to the worker’s engine', async () => {
    let aborted = false;
    const { engine } = setup(async (_json, onChunk, signal) => {
      onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'first' }, finish_reason: null }] }));
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      aborted = true;
      throw new Error('aborted');
    });
    const controller = new AbortController();
    const res = await pageEnginesFetch([engine])(CHAT_URL, post(controller.signal));
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('first');
    controller.abort();
    for (let i = 0; i < 10 && !aborted; i++) await new Promise((r) => setTimeout(r, 0));
    expect(aborted).toBe(true);
  });

  it('answers absent when nothing is downloaded, and restarts a worker that crashed', async () => {
    const { engine, create, created } = setup(streaming, []);
    expect(await engine.probe({ fresh: true })).toBeNull();
    created[0]!.fail();
    await engine.probe({ fresh: true });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe('bfi in a Web Worker — its lifecycle', () => {
  it('never starts the worker for the picker while no Bonsai is downloaded', async () => {
    const { engine, create } = setup(streaming, [], { pageStore: true });
    expect(await engine.probe({ fresh: true })).toBeNull();
    const support = await engine.support();
    expect(support.backends?.cpu).toBeDefined();
    expect(create).not.toHaveBeenCalled();
  });

  it('respawns after the worker reports a wasm trap (a FATAL frame, not an error event)', async () => {
    const { engine, create, created } = setup(streaming);
    await engine.probe({ fresh: true });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    created[0]!.deliver({ type: ENGINE_WORKER_FATAL, message: 'unreachable' });
    await new Promise((r) => setTimeout(r, 0));
    await engine.probe({ fresh: true });
    expect(create).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('tears an idle worker down and starts a fresh one on the next turn; dispose stops it', async () => {
    vi.useFakeTimers();
    try {
      const { engine, create } = setup(streaming, [REF], { idleMs: 1_000 });
      const first = engine.probe({ fresh: true });
      await vi.advanceTimersByTimeAsync(10);
      await first;
      await vi.advanceTimersByTimeAsync(1_500);
      const second = engine.probe({ fresh: true });
      await vi.advanceTimersByTimeAsync(10);
      await second;
      expect(create).toHaveBeenCalledTimes(2);
      engine.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('bfi in a Web Worker — threads, crashes, the page store and the picker', () => {
  const threads = { moduleUrl: 'https://app.test/bfi-threads/bfi_web.js', wasmUrl: 'https://app.test/bfi-threads/bfi_web_bg.wasm' };

  it('replaces a worker whose threaded build did not start with a single-threaded one, and asks again', async () => {
    const { engine, create, loadBfi, inits } = setup(streaming, [REF], { threads });
    const real = loadBfi.getMockImplementation()!;
    loadBfi.mockImplementation(async (url: string, t?: BfiThreadsSource) => {
      if (t) throw new BfiThreadsError('initThreads did not settle within 10000 ms');
      return real(url);
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const probe = await engine.probe({ fresh: true });
    expect(probe?.models.map((m) => m.ref)).toEqual([REF]);
    expect(create).toHaveBeenCalledTimes(2);
    expect(inits[0]).toMatchObject({ threads });
    expect(inits[1]).not.toHaveProperty('threads');
    // Single-threaded from then on: the next turn does not try threads again.
    const res = await pageEnginesFetch([engine])(CHAT_URL, post());
    expect(await res.text()).toContain('"content":"Hel"');
    expect(create).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('fails a model for the session after it crashed the worker twice — withheld from the probe, refused with model_keeps_crashing', async () => {
    const { engine, create, created } = setup(async (_json, onChunk) => {
      onChunk(JSON.stringify({ choices: [{ index: 0, delta: { content: 'x' }, finish_reason: null }] }));
      await new Promise(() => undefined); // the engine dies mid-answer
      return '';
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let crash = 0; crash < 2; crash++) {
      const res = await pageEnginesFetch([engine])(CHAT_URL, post());
      expect(res.status).toBe(200);
      created[crash]!.deliver({ type: ENGINE_WORKER_FATAL, message: 'unreachable' });
      expect(await res.text()).toContain('page_engine_detached');
    }
    const refused = await pageEnginesFetch([engine])(CHAT_URL, post());
    expect(refused.status).toBe(503);
    expect(await refused.text()).toContain('model_keeps_crashing');
    expect(await engine.probe({ fresh: true })).toBeNull();
    // Refused before reaching a worker: the failed model is never loaded again.
    expect(create).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  it('with relayStore, the worker reads the model through the page’s store only', async () => {
    const { engine, store } = setup(streaming, [REF], { relay: true });
    const res = await pageEnginesFetch([engine])(CHAT_URL, post());
    expect(await res.text()).toContain('"content":"lo"');
    expect(store.open).toHaveBeenCalledWith(REF);
  });

  it('offers the picker a CPU-only model through the peer that serves the CPU (the editor’s host worker)', async () => {
    const GIB = 1024 ** 3;
    const peer: LocalDeviceSupport = {
      supported: false,
      reason: 'no WebGPU in Node',
      f16: false,
      maxBufferBytes: 0,
      backends: { cpu: { supported: true, simd: true, threads: 1, kvBudgetBytes: 2 ** 29, maxMemoryBytes: 4 * GIB, deviceMemoryBytes: 16 * GIB } },
    };
    const store = { status: vi.fn(async () => 'absent' as const) };
    const create = vi.fn();
    const gpuOnly = (peerSupport?: () => Promise<LocalDeviceSupport>) =>
      createBfiWorkerEngine({ create, wasmUrl: () => 'https://app.test/w.wasm', store, backends: ['webgpu'], ...(peerSupport ? { peerSupport } : {}) });
    const row = localCatalogModel(REF)!;
    // Without the peer this webview's own CPU is not offered (it never decodes on the CPU).
    expect((await gpuOnly().support()).backends?.cpu).toBeUndefined();
    const union = await gpuOnly(async () => peer).support();
    expect(union.backends?.cpu).toEqual(peer.backends!.cpu);
    expect(localModelFit(row, union)).toEqual({ fits: true, backend: 'cpu' });
    expect(create).not.toHaveBeenCalled();
  });
});
