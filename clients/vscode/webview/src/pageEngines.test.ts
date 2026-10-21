import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webview hands its page-engine set a `bfi` Web WORKER — never an in-page engine (a
 * wasm trap would poison the panel's realm for the session) — bound to the binary Vite
 * emitted beside the bundle, serving WebGPU only, reading models through the page (the
 * extension host's file cache), and taking the host's CPU record for the picker.
 */

// Hoisted with the mocks below, which `vi.mock` lifts above every other statement.
const { createPageEngineSet, request } = vi.hoisted(() => ({
  createPageEngineSet: vi.fn((_options: unknown) => ({ engines: [], store: {}, probe: vi.fn(), fetch: vi.fn() })),
  request: vi.fn(async (_type: string, _payload?: unknown) => ({ supported: false, f16: false, maxBufferBytes: 0 })),
}));

// `deferredLocalModelStore` runs at module load (it only captures the thunk), so the mock must supply it.
vi.mock('@seanhogg/builderforce-brain-embedded', () => ({
  PAGE_ENGINE_REQUEST_TYPES: [],
  createPageEngineSet,
  deferredLocalModelStore: (_get: () => unknown) => ({}),
  servePageEngines: vi.fn(),
}));
vi.mock('@seanhogg/bfi-web/bfi_web_bg.wasm?url', () => ({ default: 'https://webview.test/media/webview/asset-bfi_web_bg.wasm' }));
vi.mock('./bfiWorker.ts?worker&url', () => ({ default: 'https://webview.test/media/webview/bfiWorker.js' }));
vi.mock('./vscodeBridge', () => ({ onHostMessage: vi.fn(() => () => undefined), post: vi.fn(), request }));

type BfiWorkerOptions = {
  create: () => unknown;
  wasmUrl: () => URL | string;
  backends?: readonly string[];
  relayStore?: boolean;
  peerSupport?: () => Promise<unknown>;
};

beforeEach(() => {
  createPageEngineSet.mockClear();
  request.mockClear();
});

describe('webviewPageEngines', () => {
  it('runs bfi in a worker on WebGPU only, loading the wasm from the emitted asset', async () => {
    const { webviewPageEngines } = await import('./pageEngines');
    webviewPageEngines();

    expect(createPageEngineSet).toHaveBeenCalledTimes(1);
    const options = createPageEngineSet.mock.calls[0]![0] as { bfiWorker?: BfiWorkerOptions; loadBfi?: unknown };
    expect(options.loadBfi).toBeUndefined();
    expect(options.bfiWorker?.backends).toEqual(['webgpu']);
    expect(options.bfiWorker?.relayStore).toBe(true);
    expect(String(options.bfiWorker?.wasmUrl())).toBe('https://webview.test/media/webview/asset-bfi_web_bg.wasm');
  });

  it("offers the picker the host worker's CPU record, asked over the model-file bridge", async () => {
    vi.resetModules();
    const { webviewPageEngines } = await import('./pageEngines');
    webviewPageEngines();
    const options = createPageEngineSet.mock.calls[createPageEngineSet.mock.calls.length - 1]![0] as { bfiWorker?: BfiWorkerOptions };
    await options.bfiWorker?.peerSupport?.();
    expect(request).toHaveBeenCalledWith('modelFile.support', {});
  });

  it("stores bfi's models in the extension host's file cache, not this webview's", async () => {
    // The engine set is memoized per module: start from a fresh one.
    vi.resetModules();
    const { webviewPageEngines } = await import('./pageEngines');
    webviewPageEngines();
    const options = createPageEngineSet.mock.calls[createPageEngineSet.mock.calls.length - 1]![0] as { hf?: { status: unknown; open: unknown } };
    expect(typeof options.hf?.status).toBe('function');
    expect(typeof options.hf?.open).toBe('function');
  });

  it('starts the worker as a same-origin blob module that imports the resource-origin bundle', async () => {
    const constructed: Array<{ url: string; options: unknown }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: string, options: unknown) {
          constructed.push({ url, options });
        }
      },
    );
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:webview/1');
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL: vi.fn() }));
    try {
      const { resourceModuleWorker } = await import('./pageEngines');
      resourceModuleWorker('https://webview.test/media/webview/bfiWorker.js', 'bfi');
      expect(constructed).toEqual([{ url: 'blob:webview/1', options: { type: 'module', name: 'bfi' } }]);
      expect(await createObjectURL.mock.calls[0]![0].text()).toBe('import "https://webview.test/media/webview/bfiWorker.js";');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
