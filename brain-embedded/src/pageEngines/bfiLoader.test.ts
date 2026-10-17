import { afterEach, describe, expect, it, vi } from 'vitest';
import { bfiWebLoader, loadBfiWeb, resetBfiWebForTests, type BfiWebModule } from './bfiLoader';

/**
 * The ONE `bfi-web` loader every host passes as `loadBfi`. Load-bearing:
 *
 *  - the wasm-bindgen initializer runs ONCE per page, with the host's wasm URL;
 *  - what comes back is the `BfiEngine` class, in the shape `createBfiEngine` takes;
 *  - a failed load is not cached, so the next call tries again.
 */

function fakeModule(init?: () => Promise<unknown>) {
  const BfiEngine = { create: vi.fn(), support: vi.fn(), contextFor: vi.fn() };
  const module: BfiWebModule & { default: ReturnType<typeof vi.fn> } = {
    default: vi.fn(init ?? (async () => ({}))),
    BfiEngine,
  };
  return module;
}

afterEach(() => resetBfiWebForTests());

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

describe('bfiWebLoader', () => {
  it('resolves a lazily computed URL only when the engine first loads', async () => {
    const url = vi.fn(async () => 'chrome-extension://id/bfi_web_bg.wasm');
    const loadBfi = bfiWebLoader(url);
    expect(url).not.toHaveBeenCalled();

    // The real importer would dynamic-import the package; the first call seeds the
    // memo through the injectable path so this stays a unit test.
    const module = fakeModule();
    await loadBfiWeb('chrome-extension://id/bfi_web_bg.wasm', async () => module);
    const loaded = await loadBfi();
    expect(url).toHaveBeenCalledTimes(1);
    expect(loaded.BfiEngine).toBe(module.BfiEngine);
  });
});
