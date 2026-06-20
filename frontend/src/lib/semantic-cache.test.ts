import { describe, expect, it, vi } from 'vitest';
import type { SemanticCache } from '@seanhogg/builderforce-memory';
import { runThroughCache } from './semantic-cache';

/** A minimal SemanticCache stand-in (only getOrGenerate is used by runThroughCache). */
function fakeCache(over: Partial<SemanticCache> = {}): SemanticCache {
  return { getOrGenerate: vi.fn(), ...over } as unknown as SemanticCache;
}

describe('runThroughCache', () => {
  it('falls through to generate() when there is no cache', async () => {
    const generate = vi.fn(async () => 'fresh');
    const r = await runThroughCache(null, 'q', generate);
    expect(r).toEqual({ response: 'fresh', cached: false });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('returns a cache hit without calling generate()', async () => {
    const generate = vi.fn(async () => 'fresh');
    const cache = fakeCache({
      getOrGenerate: vi.fn(async () => ({ response: 'cached', cached: true, tier: 'l1' as const })),
    });
    const r = await runThroughCache(cache, 'q', generate);
    expect(r).toEqual({ response: 'cached', cached: true });
    expect(generate).not.toHaveBeenCalled();
  });

  it('on a miss the cache runs generate() and reports cached:false', async () => {
    const generate = vi.fn(async () => 'fresh');
    // Real-ish: getOrGenerate invokes the generator on a miss.
    const cache = fakeCache({
      getOrGenerate: vi.fn(async (_q: string, gen: () => Promise<string>) => ({
        response: await gen(),
        cached: false,
      })),
    });
    const r = await runThroughCache(cache, 'q', generate);
    expect(r).toEqual({ response: 'fresh', cached: false });
    expect(generate).toHaveBeenCalledOnce();
  });

  it('degrades to a direct generate() if the cache throws', async () => {
    const generate = vi.fn(async () => 'fresh');
    const cache = fakeCache({
      getOrGenerate: vi.fn(async () => {
        throw new Error('embedder exploded');
      }),
    });
    const r = await runThroughCache(cache, 'q', generate);
    expect(r).toEqual({ response: 'fresh', cached: false });
    expect(generate).toHaveBeenCalledOnce();
  });
});
