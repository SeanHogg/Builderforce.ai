import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootEmbed } from './embed';

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('script').forEach((s) => s.remove());
  delete window.BFReplay;
  delete window.__bfReplay;
});

describe('embed/v1.js', () => {
  it('boots replay from data-site', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      ({ ok: true, json: async () => ({ enabled: true, recorderUrl: 'https://cdn.test/replay/r/recorder.abcdef123456.js' }) }) as unknown as Response,
    );
    vi.stubGlobal('fetch', fetchFn);
    const script = document.createElement('script');
    script.dataset.site = 'bfr_abc';
    script.setAttribute('data-builderforce-key', 'bf_42');
    document.head.appendChild(script);
    await bootEmbed(script);
    expect(fetchFn).toHaveBeenCalledWith('https://api.builderforce.ai/api/replay-ingest/v1/config?site=bfr_abc', { credentials: 'omit' });
    expect(window.__bfReplay?.site).toBe('bfr_abc');
  });

  it('never uses the workspace key as a replay key', async () => {
    const fetchFn = vi.fn();
    vi.stubGlobal('fetch', fetchFn);
    const script = document.createElement('script');
    script.setAttribute('data-builderforce-key', 'bf_42');
    document.head.appendChild(script);
    await bootEmbed(script);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(window.BFReplay).toBeUndefined();
  });
});
