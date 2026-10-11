import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
  document.querySelectorAll('script').forEach((s) => s.remove());
  Object.defineProperty(document, 'currentScript', { configurable: true, get: () => null });
  const w = window as unknown as { BuilderForce?: { session?: unknown } };
  delete w.BuilderForce;
});

describe('embed/v1.js boot', () => {
  it('installs window.BuilderForce.session and injects the hashed recorder', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-builderforce-key', 'site_abc');
    script.src = 'https://cdn.builderforce.ai/embed/v1.js';
    document.body.appendChild(script);
    Object.defineProperty(document, 'currentScript', { configurable: true, get: () => script });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ recorder: '/replay/r/recorder.deadbeef.js', hash: 'deadbeef' }),
      })),
    );

    await import('./embed');

    const w = window as unknown as { BuilderForce?: { session?: { init: unknown } } };
    expect(w.BuilderForce?.session).toBeTruthy();

    await vi.waitFor(() => {
      const injected = document.querySelector(
        'script[src="https://cdn.builderforce.ai/replay/r/recorder.deadbeef.js"]',
      );
      expect(injected).toBeTruthy();
    });

    vi.unstubAllGlobals();
  });

  it('does not fetch without a site key', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    await import('./embed');
    expect(fetchFn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
