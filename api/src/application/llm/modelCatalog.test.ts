import { describe, it, expect, vi, afterEach } from 'vitest';
import { getCatalogCached } from './modelCatalog';
import type { Env } from '../../env';

const originalFetch = globalThis.fetch;
afterEach(() => { (globalThis as { fetch: typeof fetch }).fetch = originalFetch; });

describe('getCatalogCached routable annotation [1305]', () => {
  it('flags ids our cascade actually routes (in the vendor catalog) and leaves the rest unrouted', async () => {
    (globalThis as { fetch: typeof fetch }).fetch = vi.fn(async () => new Response(
      JSON.stringify({
        data: [
          // In our curated FREE vendor catalog → routable, free pool.
          { id: 'google/gemma-4-31b-it:free', pricing: { prompt: '0', completion: '0' } },
          // An OpenRouter id we list but do NOT route.
          { id: 'some-vendor/never-routed-model-xyz', pricing: { prompt: '0.000001', completion: '0.000002' } },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    // No AUTH_CACHE_KV → getOrSetCached falls through to the live (mocked) loader.
    const list = await getCatalogCached({} as Env);
    const routed = list.find((m) => m.id === 'google/gemma-4-31b-it:free');
    const notRouted = list.find((m) => m.id === 'some-vendor/never-routed-model-xyz');

    expect(routed?.routable).toBe(true);
    expect(routed?.pool).toBe('free');
    expect(notRouted?.routable).toBe(false);
    expect(notRouted?.pool).toBeUndefined();
  });
});
