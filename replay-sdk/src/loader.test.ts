import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  document.querySelectorAll('script').forEach((s) => s.remove());
});

describe('loader boot', () => {
  it('injects the hashed recorder from the manifest and inits with the site key', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-builderforce-key', 'site_abc');
    document.body.appendChild(script);
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });

    const fetchFn = vi.fn(async () => ({
      ok: true,
      json: async () => ({ recorder: '/replay/r/recorder.deadbeef.js' }),
    }));

    const { boot } = await import('./loader');
    boot({ cdn: 'https://cdn.example.test', fetchFn: fetchFn as unknown as typeof fetch });

    await vi.waitFor(() => {
      const injected = document.querySelector('script[src="https://cdn.example.test/replay/r/recorder.deadbeef.js"]');
      expect(injected).toBeTruthy();
    });
  });

  it('does nothing without a site key', async () => {
    const fetchFn = vi.fn();
    const { boot } = await import('./loader');
    boot({ fetchFn: fetchFn as unknown as typeof fetch });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
