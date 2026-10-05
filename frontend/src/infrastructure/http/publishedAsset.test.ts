import { afterEach, describe, expect, it, vi } from 'vitest';

import { fetchPublishedAsset } from './publishedAsset';

/** next-on-pages' per-request slot (see `publishedAsset.ts`). */
const REQUEST_CONTEXT = Symbol.for('__cloudflare-request-context__');
const slot = globalThis as Record<symbol, unknown>;

describe('fetchPublishedAsset', () => {
  afterEach(() => {
    delete slot[REQUEST_CONTEXT];
    vi.unstubAllGlobals();
  });

  it('reads through the worker ASSETS binding on the server — never a self-fetch', async () => {
    const assets = { fetch: vi.fn(async () => new Response('body')) };
    const network = vi.fn();
    slot[REQUEST_CONTEXT] = { env: { ASSETS: assets } };
    vi.stubGlobal('fetch', network);
    vi.stubGlobal('window', undefined);

    const response = await fetchPublishedAsset('/blog-i18n/en/post.md?v=1', 'https://builderforce.ai');

    expect(await response.text()).toBe('body');
    expect(String((assets.fetch.mock.calls[0] as unknown[])[0])).toBe('https://builderforce.ai/blog-i18n/en/post.md?v=1');
    expect(network).not.toHaveBeenCalled();
  });

  it('falls back to a plain network fetch with no cache mode when there is no binding', async () => {
    const network = vi.fn(async () => new Response('body'));
    vi.stubGlobal('fetch', network);

    await fetchPublishedAsset('/i18n/fr.json?v=1', 'https://example.test');

    expect(network).toHaveBeenCalledWith('https://example.test/i18n/fr.json?v=1', { signal: undefined });
  });
});
