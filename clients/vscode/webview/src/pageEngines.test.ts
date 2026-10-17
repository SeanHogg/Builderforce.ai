import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The webview hands its page-engine set the vendored `bfi-web` loader, bound to the
 * binary Vite emitted beside the bundle. Without it the `bfi` engine is never offered and
 * every Bonsai row reads `engine_unavailable` — which is what shipped before the wasm was
 * vendored.
 */

// Hoisted with the mocks below, which `vi.mock` lifts above every other statement.
const { createPageEngineSet, loadBfiWeb } = vi.hoisted(() => ({
  createPageEngineSet: vi.fn((_options: unknown) => ({ engines: [], store: {}, probe: vi.fn(), fetch: vi.fn() })),
  loadBfiWeb: vi.fn(async (_url: string) => ({ BfiEngine: {} })),
}));

vi.mock('@seanhogg/builderforce-brain-embedded', () => ({ createPageEngineSet }));
vi.mock('@seanhogg/builderforce-brain-embedded/bfi', () => ({
  bfiWebLoader: (url: () => string | URL) => async () => loadBfiWeb(String(url())),
}));
vi.mock('@seanhogg/bfi-web/bfi_web_bg.wasm?url', () => ({ default: 'https://webview.test/media/webview/asset-bfi_web_bg.wasm' }));
vi.mock('./vscodeBridge', () => ({ onHostMessage: vi.fn(), post: vi.fn() }));
vi.mock('./pageEngineHost', () => ({ servePageEngines: vi.fn() }));

beforeEach(() => {
  createPageEngineSet.mockClear();
  loadBfiWeb.mockClear();
});

describe('webviewPageEngines', () => {
  it('offers the bfi engine, loading the wasm from the emitted asset', async () => {
    const { webviewPageEngines } = await import('./pageEngines');
    webviewPageEngines();

    expect(createPageEngineSet).toHaveBeenCalledTimes(1);
    const options = createPageEngineSet.mock.calls[0]![0] as { loadBfi?: () => Promise<unknown> };
    expect(typeof options.loadBfi).toBe('function');
    // The wasm is not touched until the engine first needs it.
    expect(loadBfiWeb).not.toHaveBeenCalled();

    await options.loadBfi!();
    expect(loadBfiWeb).toHaveBeenCalledWith('https://webview.test/media/webview/asset-bfi_web_bg.wasm');
  });
});
