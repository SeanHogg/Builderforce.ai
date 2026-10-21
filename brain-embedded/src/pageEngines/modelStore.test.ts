import { describe, expect, it, vi } from 'vitest';
import type { LocalDeviceSupport } from '@builderforce/local-inference';
import { FakeCacheStorage } from '../test/fakeCacheStorage';
import { LOCAL_MODEL_CACHE, createHfModelStore, hfResolveUrl } from './hfModelStore';
import { createLocalModelStore } from './modelStore';
import type { WebLlmModelCache } from './webllmEngine';

/**
 * The picker's ONE store. Load-bearing: a download streams into Cache Storage with
 * progress and leaves NOTHING behind when it fails; `status` only looks; the facade gives
 * every catalog row one state whichever backend holds it, and a finished download
 * invalidates the engines' probes.
 */

const BONSAI = 'local/bfi/bonsai-1.7b-q1_0';
const BONSAI_URL = hfResolveUrl('prism-ml/Bonsai-1.7B-gguf', 'Bonsai-1.7B-Q1_0.gguf');
const QWEN = 'local/webllm/Qwen3-1.7B-q4f16_1-MLC';

function bodyOf(parts: readonly number[], failAfter?: Error): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < parts.length) controller.enqueue(new Uint8Array(parts[i++]!).fill(7));
      else if (failAfter) controller.error(failAfter);
      else controller.close();
    },
  });
}

function hfFetch(parts: readonly number[], contentLength: number, failAfter?: Error) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(bodyOf(parts, failAfter), { headers: { 'content-length': String(contentLength) } }),
  );
}

describe('createHfModelStore', () => {
  it('streams the resolve URL into Cache Storage with progress, then opens it back', async () => {
    const caches = new FakeCacheStorage();
    const fetch = hfFetch([4, 4, 4], 12);
    const store = createHfModelStore({ caches: caches.asCacheStorage(), fetch });
    expect(await store.status(BONSAI)).toBe('absent');
    const progress: number[] = [];
    await store.download(BONSAI, (f) => progress.push(f));
    expect(fetch.mock.calls[0]![0]).toBe(BONSAI_URL);
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit' });
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
    expect(await store.status(BONSAI)).toBe('ready');
    const opened = await store.open(BONSAI);
    expect(opened.bytes).toBe(12);
    expect((await new Response(opened.stream).arrayBuffer()).byteLength).toBe(12);
  });

  it('only looks when asked for status — no bucket is created', async () => {
    const caches = new FakeCacheStorage();
    const store = createHfModelStore({ caches: caches.asCacheStorage(), fetch: hfFetch([], 0) });
    expect(await store.status(BONSAI)).toBe('absent');
    expect(caches.buckets.has(LOCAL_MODEL_CACHE)).toBe(false);
  });

  it('leaves nothing behind when the download fails or comes up short', async () => {
    const caches = new FakeCacheStorage();
    const broken = createHfModelStore({ caches: caches.asCacheStorage(), fetch: hfFetch([4], 12, new Error('reset')) });
    await expect(broken.download(BONSAI)).rejects.toThrow('reset');
    expect(await broken.status(BONSAI)).toBe('absent');

    const short = createHfModelStore({ caches: caches.asCacheStorage(), fetch: hfFetch([4], 12) });
    await expect(short.download(BONSAI)).rejects.toThrow(/download_incomplete/);
    expect(await short.status(BONSAI)).toBe('absent');
  });

  it('refuses a non-OK answer and removes a cached model', async () => {
    const caches = new FakeCacheStorage();
    const missing = createHfModelStore({
      caches: caches.asCacheStorage(),
      fetch: vi.fn(async () => new Response('nope', { status: 404 })),
    });
    await expect(missing.download(BONSAI)).rejects.toThrow(/HTTP 404/);

    const store = createHfModelStore({ caches: caches.asCacheStorage(), fetch: hfFetch([2], 2) });
    await store.download(BONSAI);
    await store.remove(BONSAI);
    expect(await store.status(BONSAI)).toBe('absent');
  });

  it('rejects a ref that is not an hf-file catalog model', async () => {
    const store = createHfModelStore({ caches: new FakeCacheStorage().asCacheStorage(), fetch: hfFetch([], 0) });
    await expect(store.download(QWEN)).rejects.toThrow(/unknown_model/);
  });
});

describe('createLocalModelStore', () => {
  const gpu = (over: Partial<LocalDeviceSupport> = {}) => async (): Promise<LocalDeviceSupport> => ({
    supported: true,
    f16: true,
    maxBufferBytes: 2 ** 30,
    ...over,
  });

  function webllmCache(cached: string[] = []): WebLlmModelCache & { download: ReturnType<typeof vi.fn> } {
    return {
      has: vi.fn(async (id: string) => cached.includes(id)),
      download: vi.fn(async (_id: string, onProgress?: (f: number) => void) => {
        onProgress?.(0.5);
        onProgress?.(1);
      }),
      remove: vi.fn(async () => undefined),
    };
  }

  it('gives every catalog row one state, whichever backend holds it', async () => {
    const caches = new FakeCacheStorage();
    const hf = createHfModelStore({ caches: caches.asCacheStorage(), fetch: hfFetch([2], 2) });
    await hf.download(BONSAI);
    const store = createLocalModelStore({
      hf,
      webllm: webllmCache(['Qwen3-1.7B-q4f16_1-MLC']),
      support: { bfi: gpu({ f16: false, maxBufferBytes: 2 ** 27 }), webllm: gpu({ maxBufferBytes: 2 ** 27 }) },
    });
    const rows = new Map((await store.listLocalModels()).map((r) => [r.ref, r]));
    expect(rows.get(BONSAI)).toMatchObject({ state: 'ready' });
    expect(rows.get('local/bfi/bonsai-8b-q1_0')).toMatchObject({ state: 'absent' });
    expect(rows.get(QWEN)).toMatchObject({ state: 'ready' });
    expect(rows.get('local/webllm/Qwen3-4B-q4f16_1-MLC')).toMatchObject({ state: 'absent' });
    // The 8B Hermes needs a 1 GiB binding this adapter does not grant.
    expect(rows.get('local/webllm/Hermes-3-Llama-3.1-8B-q4f16_1-MLC')).toMatchObject({
      state: 'unsupported',
      reason: 'buffer_too_small',
    });
  });

  it('labels each runnable row with the backend the fit chose — the CPU for bfi without WebGPU', async () => {
    const caches = new FakeCacheStorage();
    const hf = createHfModelStore({ caches: caches.asCacheStorage(), fetch: hfFetch([2], 2) });
    await hf.download(BONSAI);
    const noGpu: LocalDeviceSupport = {
      supported: false,
      reason: 'navigator.gpu is missing',
      f16: false,
      maxBufferBytes: 0,
      backends: { cpu: { supported: true, simd: true, threads: 1, kvBudgetBytes: 2 ** 29, maxMemoryBytes: 2 ** 32 } },
    };
    const store = createLocalModelStore({
      hf,
      webllm: webllmCache(['Qwen3-1.7B-q4f16_1-MLC']),
      support: { bfi: async () => noGpu, webllm: gpu({ maxBufferBytes: 2 ** 27 }) },
    });
    // A phone: an unreported RAM reads as 2 GiB there (a desktop assumes 8 GiB).
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36' });
    const rows = new Map((await store.listLocalModels().finally(() => vi.unstubAllGlobals())).map((r) => [r.ref, r]));
    expect(rows.get(BONSAI)).toMatchObject({ state: 'ready', backend: 'cpu' });
    // 4B (4 GiB floor) and 8B (8 GiB) cannot run on that phone.
    expect(rows.get('local/bfi/bonsai-4b-q1_0')).toMatchObject({ state: 'unsupported', reason: 'memory_insufficient' });
    expect(rows.get('local/bfi/bonsai-8b-q1_0')).toMatchObject({ state: 'unsupported', reason: 'memory_insufficient' });
    expect(rows.get(QWEN)).toMatchObject({ state: 'ready', backend: 'webgpu' });
  });

  it('marks the rows of an engine the host does not carry as engine_unavailable', async () => {
    const store = createLocalModelStore({ webllm: webllmCache(), support: { webllm: gpu() } });
    const bonsai = (await store.listLocalModels()).find((r) => r.ref === BONSAI);
    expect(bonsai).toMatchObject({ state: 'unsupported', reason: 'engine_unavailable' });
    await expect(store.download(BONSAI)).rejects.toThrow(/engine_unavailable/);
  });

  it('reports downloading with progress, notifies, and invalidates the engines when done', async () => {
    let release!: () => void;
    const webllm = webllmCache();
    webllm.download.mockImplementation(async (_id: string, onProgress?: (f: number) => void) => {
      onProgress?.(0.25);
      await new Promise<void>((resolve) => (release = resolve));
    });
    const engine = { invalidate: vi.fn() };
    const store = createLocalModelStore({ webllm, support: { webllm: gpu() }, engines: [engine] });
    const listener = vi.fn();
    store.subscribe(listener);
    const progress: number[] = [];
    const done = store.download(QWEN, (f) => progress.push(f));
    // Joining an in-flight download does not start a second one.
    expect(store.download(QWEN)).toBe(done);
    expect((await store.listLocalModels()).find((r) => r.ref === QWEN)).toMatchObject({
      state: 'downloading',
      progress: 0.25,
    });
    release();
    await done;
    expect(progress).toEqual([0.25]);
    expect(webllm.download).toHaveBeenCalledTimes(1);
    expect(engine.invalidate).toHaveBeenCalled();
    expect(listener).toHaveBeenCalled();
  });

  it('removes through the backend and invalidates the engines', async () => {
    const webllm = webllmCache(['Qwen3-1.7B-q4f16_1-MLC']);
    const engine = { invalidate: vi.fn() };
    const store = createLocalModelStore({ webllm, support: { webllm: gpu() }, engines: [engine] });
    await store.remove(QWEN);
    expect(webllm.remove).toHaveBeenCalledWith('Qwen3-1.7B-q4f16_1-MLC');
    expect(engine.invalidate).toHaveBeenCalled();
  });
});
