import { describe, expect, it, vi } from 'vitest';
import {
  TRANSLATE_CACHE_TTL_SECONDS,
  createTranslateText,
  translateCacheKey,
  type TranslationCache,
} from './translateText';

/** In-memory read-through cache with the same contract as getOrSetCached. */
function memoryCache(): { cache: TranslationCache; store: Map<string, string>; ttls: number[] } {
  const store = new Map<string, string>();
  const ttls: number[] = [];
  const cache: TranslationCache = async (key, loader, ttl) => {
    ttls.push(ttl);
    const hit = store.get(key);
    if (hit !== undefined) return hit;
    const v = await loader();
    store.set(key, v);
    return v;
  };
  return { cache, store, ttls };
}

describe('TranslateText', () => {
  it('returns the texts unchanged, with no model call, when from === to', async () => {
    const model = { translate: vi.fn() };
    const run = createTranslateText({ model, cache: memoryCache().cache });
    expect(await run({ texts: ['a', 'b'], to: 'en', from: 'en' })).toEqual(['a', 'b']);
    expect(model.translate).not.toHaveBeenCalled();
  });

  it('never has more than 4 model calls in flight', async () => {
    let inFlight = 0;
    let peak = 0;
    const model = { translate: vi.fn(async (t: string) => { inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 1)); inFlight--; return t; }) };
    const run = createTranslateText({ model, cache: async (_k, loader) => loader() });
    await run({ texts: Array.from({ length: 12 }, (_, i) => `t${i}`), to: 'en', from: 'es' });
    expect(model.translate).toHaveBeenCalledTimes(12);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('builds the versioned key from sha256(text), from and to', async () => {
    expect(await translateCacheKey('hola', 'es', 'en')).toMatch(/^translate:v1:[0-9a-f]{64}:es:en$/);
  });

  it('serves a repeat request from cache without a model call', async () => {
    const model = { translate: vi.fn(async (t: string) => `en:${t}`) };
    const { cache } = memoryCache();
    const run = createTranslateText({ model, cache });
    expect(await run({ texts: ['hola'], to: 'en', from: 'es' })).toEqual(['en:hola']);
    expect(await run({ texts: ['hola'], to: 'en', from: 'es' })).toEqual(['en:hola']);
    expect(model.translate).toHaveBeenCalledTimes(1);
  });

  it('calls the model only for the misses in a partial-hit batch, preserving order', async () => {
    const model = { translate: vi.fn(async (t: string) => `en:${t}`) };
    const { cache } = memoryCache();
    const run = createTranslateText({ model, cache });
    await run({ texts: ['a'], to: 'en', from: 'es' });
    model.translate.mockClear();
    expect(await run({ texts: ['a', 'b', 'c'], to: 'en', from: 'es' })).toEqual(['en:a', 'en:b', 'en:c']);
    expect(model.translate.mock.calls.map((c) => c[0]).sort()).toEqual(['b', 'c']);
  });

  it('caches with a TTL and never caches a failed model call', async () => {
    const model = { translate: vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue('ok') };
    const { cache, store, ttls } = memoryCache();
    const run = createTranslateText({ model, cache });
    await expect(run({ texts: ['x'], to: 'de', from: 'en' })).rejects.toThrow('down');
    expect(store.size).toBe(0);
    expect(await run({ texts: ['x'], to: 'de', from: 'en' })).toEqual(['ok']);
    expect(ttls.every((t) => t === TRANSLATE_CACHE_TTL_SECONDS)).toBe(true);
  });
});
