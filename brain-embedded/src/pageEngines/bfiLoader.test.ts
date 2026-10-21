import { afterEach, describe, expect, it, vi } from 'vitest';
import { BFI_THREADS_START_TIMEOUT_MS, forgetBfiWeb, isBfiThreadsError, loadBfiWeb, type BfiWebModule } from './bfiLoader';

/**
 * The ONE `bfi-web` loader every `bfi` worker loads the wasm with. Load-bearing:
 *
 *  - the wasm-bindgen initializer runs ONCE per realm, with the host's wasm URL;
 *  - what comes back is the `BfiEngine` class, in the shape `createBfiEngine` takes;
 *  - a failed load is not cached, so the next call tries again;
 *  - a threaded artifact that fails or HANGS starting its pool rejects with
 *    `BfiThreadsError` and never loads the default artifact beside it.
 */

function fakeModule(init?: () => Promise<unknown>) {
  const BfiEngine = { create: vi.fn(), support: vi.fn(), contextFor: vi.fn() };
  const module: BfiWebModule & { default: ReturnType<typeof vi.fn> } = {
    default: vi.fn(init ?? (async () => ({}))),
    BfiEngine,
  };
  return module;
}

afterEach(() => forgetBfiWeb());

describe('loadBfiWeb', () => {
  it('initializes the wasm once, with the URL the host passed', async () => {
    const module = fakeModule();
    const importer = vi.fn(async () => module);
    const url = new URL('https://host.test/assets/bfi_web_bg.wasm');

    const [first, second] = await Promise.all([loadBfiWeb(url, importer), loadBfiWeb(url, importer)]);
    const third = await loadBfiWeb(url, importer);

    expect(importer).toHaveBeenCalledTimes(1);
    expect(module.default).toHaveBeenCalledTimes(1);
    expect(module.default).toHaveBeenCalledWith({ module_or_path: url });
    expect(first.BfiEngine).toBe(module.BfiEngine);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('retries after a failed initialization', async () => {
    const broken = fakeModule(async () => {
      throw new Error('fetch failed');
    });
    await expect(loadBfiWeb('/bfi_web_bg.wasm', async () => broken)).rejects.toThrow('fetch failed');

    const working = fakeModule();
    const loaded = await loadBfiWeb('/bfi_web_bg.wasm', async () => working);
    expect(loaded.BfiEngine).toBe(working.BfiEngine);
    expect(working.default).toHaveBeenCalledWith({ module_or_path: '/bfi_web_bg.wasm' });
  });
});

describe('loadBfiWeb — the threaded artifact', () => {
  const threads = { moduleUrl: 'https://app.test/bfi-threads/bfi_web.js', wasmUrl: 'https://app.test/bfi-threads/bfi_web_bg.wasm' };
  const isolated = () => {
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('Worker', class {});
  };
  afterEach(() => vi.unstubAllGlobals());

  it('loads it and starts the pool where threads exist and no WebGPU adapter does', async () => {
    isolated();
    const single = fakeModule();
    const threaded = { ...fakeModule(), initThreads: vi.fn(async (n: number) => n) };
    const importThreads = vi.fn(async () => threaded);
    const out = await loadBfiWeb('https://app.test/bfi_web_bg.wasm', async () => single, { threads, threadCount: 6, importThreads });
    expect(importThreads).toHaveBeenCalledWith(threads.moduleUrl);
    expect(threaded.default).toHaveBeenCalledWith({ module_or_path: threads.wasmUrl });
    expect(threaded.initThreads).toHaveBeenCalledWith(6);
    expect(single.default).not.toHaveBeenCalled();
    expect(out.BfiEngine).toBe(threaded.BfiEngine);
  });

  it('keeps the default artifact when the context is not cross-origin isolated', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    vi.stubGlobal('Worker', class {});
    const single = fakeModule();
    const importThreads = vi.fn();
    await loadBfiWeb('https://app.test/bfi_web_bg.wasm', async () => single, { threads, importThreads });
    expect(importThreads).not.toHaveBeenCalled();
    expect(single.default).toHaveBeenCalled();
  });

  it('prefers the default artifact (WebGPU) when an adapter exists', async () => {
    isolated();
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) }, hardwareConcurrency: 8 });
    const single = fakeModule();
    const importThreads = vi.fn();
    await loadBfiWeb('https://app.test/bfi_web_bg.wasm', async () => single, { threads, importThreads });
    expect(importThreads).not.toHaveBeenCalled();
    expect(single.default).toHaveBeenCalled();
  });

  it('rejects with BfiThreadsError — never loading the default artifact beside it — when the pool fails to start', async () => {
    isolated();
    const single = fakeModule();
    const broken = { ...fakeModule(), initThreads: vi.fn(async () => Promise.reject(new Error('no SAB'))) };
    const importer = vi.fn(async () => single);
    const failure = await loadBfiWeb('https://app.test/bfi_web_bg.wasm', importer, { threads, importThreads: async () => broken }).catch((e: unknown) => e);
    expect(isBfiThreadsError(failure)).toBe(true);
    expect(String((failure as Error).message)).toContain('no SAB');
    expect(importer).not.toHaveBeenCalled();
    expect(single.default).not.toHaveBeenCalled();
  });

  it('times out a pool start that never settles, after BFI_THREADS_START_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    try {
      isolated();
      const single = fakeModule();
      const importer = vi.fn(async () => single);
      const hanging = { ...fakeModule(), initThreads: vi.fn(() => new Promise<number>(() => undefined)) };
      const settled = vi.fn();
      const load = loadBfiWeb('https://app.test/bfi_web_bg.wasm', importer, { threads, importThreads: async () => hanging }).then(
        () => settled('resolved'),
        (e: unknown) => settled(e),
      );
      await vi.advanceTimersByTimeAsync(BFI_THREADS_START_TIMEOUT_MS - 1);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await load;
      expect(isBfiThreadsError(settled.mock.calls[0]![0])).toBe(true);
      expect(String((settled.mock.calls[0]![0] as Error).message)).toContain('initThreads');
      expect(importer).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
