import { describe, expect, it, vi } from 'vitest';
import { MODEL_REGISTRY } from '../diffusion-models';
import type { LcmModelDescriptor } from '../../types';
import type { FetchOptions } from '../weight-cache';
import { WeightPrefetch, modelWeightFiles, weightRequest, type WeightPrefetchDeps } from './weight-prefetch';
import type { WeightSourceConfig } from './weight-prefetch';

/**
 * Refinement weights are WARMED into the weight store one file at a time
 * (never held in memory by the prefetcher, never demand-loaded by it), a
 * refinement fetch joining a warm sees its progress and then reads the store,
 * and the warm stops on a failed persist, under memory pressure, without
 * IndexedDB, and on dispose.
 */

/** Every value a prefetch loader resolved to — must never be a buffer. */
const loaderValues = vi.hoisted((): unknown[] => []);
/** Calls to the prefetcher's demand path — fetch() must never make one. */
const requestCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('@seanhogg/builderforce-webcontainers/ml', async (importOriginal) => {
  const ml = await importOriginal<typeof import('@seanhogg/builderforce-webcontainers/ml')>();
  return {
    ...ml,
    createPrefetcher: (config: Parameters<typeof ml.createPrefetcher>[0]) => {
      const prefetcher = ml.createPrefetcher({
        ...config,
        loader: async (target, signal) => {
          const value = await config.loader(target, signal);
          loaderValues.push(value);
          return value;
        },
      });
      return {
        ...prefetcher,
        request: (...args: Parameters<typeof prefetcher.request>) => {
          requestCalls.count += 1;
          return prefetcher.request(...args);
        },
      };
    },
  };
});

const SOURCE: WeightSourceConfig = { apiKey: 'k', weightSources: ['huggingface-cdn'] };
const REFINE = 'lcm-dreamshaper-v7' as const;
const refineDescriptor = MODEL_REGISTRY[REFINE] as LcmModelDescriptor;
const refineFiles = modelWeightFiles(refineDescriptor);
const refineKeys = refineFiles.map((f) => `${REFINE}/${f}`);

function bytesOf(key: string): ArrayBuffer {
  return new TextEncoder().encode(key).buffer as ArrayBuffer;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A stand-in for getOrFetchWeight over the weight store: a store miss is a
 *  network download (counted) that is then persisted (unless `persist` is
 *  false — then onPersistFailed fires); a hit reports full progress. Tracks the
 *  peak number of concurrent downloads. */
function fakeWeightStore({ persist = true } = {}) {
  const stored = new Map<string, ArrayBuffer>();
  const network: string[] = [];
  let inFlight = 0;
  const peak = { value: 0 };
  const load = vi.fn(async (opts: FetchOptions) => {
    const hit = stored.get(opts.cacheKey);
    if (hit) {
      opts.onProgress?.(hit.byteLength, hit.byteLength);
      return hit;
    }
    network.push(opts.cacheKey);
    inFlight += 1;
    peak.value = Math.max(peak.value, inFlight);
    await tick();
    inFlight -= 1;
    const bytes = bytesOf(opts.cacheKey);
    if (persist) stored.set(opts.cacheKey, bytes);
    else opts.onPersistFailed?.();
    return bytes;
  });
  const isStored = async (key: string) => stored.has(key);
  return { stored, network, load, isStored, peak };
}

function create(deps: WeightPrefetchDeps): WeightPrefetch {
  return new WeightPrefetch(REFINE, SOURCE, { canPersist: () => true, ...deps });
}

const requestFor = (file: string, onProgress?: FetchOptions['onProgress']) => ({
  ...weightRequest(refineDescriptor, file, SOURCE),
  onProgress,
});

describe('WeightPrefetch', () => {
  it('warms the refinement files one at a time, holding no buffer in the prefetcher', async () => {
    loaderValues.length = 0;
    const store = fakeWeightStore();
    const prefetch = create({ load: store.load, isStored: store.isStored });

    prefetch.start();
    await vi.waitFor(() => expect(loaderValues).toHaveLength(refineKeys.length));
    await tick();

    expect(store.network).toEqual(refineKeys);
    expect(store.peak.value).toBe(1);
    expect(loaderValues.every((v) => typeof v === 'number')).toBe(true);
    expect([...store.stored.keys()].sort()).toEqual([...refineKeys].sort());
    expect(prefetch.residentIds()).toEqual([]);
  });

  it('joins an in-flight warm, forwarding its progress, then reads the store without a second download', async () => {
    requestCalls.count = 0;
    const store = fakeWeightStore();
    let finish!: () => void;
    let warmProgress!: FetchOptions['onProgress'];
    const load = vi.fn(async (opts: FetchOptions) => {
      if (opts.cacheKey !== refineKeys[0] || store.stored.has(opts.cacheKey)) return store.load(opts);
      warmProgress = opts.onProgress;
      opts.onProgress?.(10, 100);
      await new Promise<void>((resolve) => (finish = resolve));
      return store.load(opts);
    });
    const prefetch = create({ load, isStored: store.isStored });
    prefetch.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    const onProgress = vi.fn();
    const pending = prefetch.fetch(requestFor(refineFiles[0]!, onProgress));
    await tick();
    expect(onProgress).toHaveBeenLastCalledWith(10, 100); // latest value, immediately
    warmProgress?.(50, 100);
    expect(onProgress).toHaveBeenLastCalledWith(50, 100); // and every update after
    finish();
    const bytes = await pending;

    expect(new TextDecoder().decode(bytes)).toBe(refineKeys[0]);
    expect(store.network.filter((k) => k === refineKeys[0])).toHaveLength(1);
    expect(onProgress).toHaveBeenLastCalledWith(bytes.byteLength, bytes.byteLength);
    expect(requestCalls.count).toBe(0);
  });

  it('claims a file whose warm has not begun and loads it directly with the caller\'s progress', async () => {
    requestCalls.count = 0;
    const store = fakeWeightStore();
    const prefetch = create({ load: store.load, isStored: store.isStored });
    const onProgress = vi.fn();
    const last = refineFiles[refineFiles.length - 1]!;

    prefetch.start();
    await prefetch.fetch(requestFor(last, onProgress));
    await vi.waitFor(() => expect(new Set(store.network).size).toBe(refineKeys.length));
    await tick();

    expect(store.network.filter((k) => k === `${REFINE}/${last}`)).toHaveLength(1);
    expect(store.load.mock.calls.find((c) => c[0].cacheKey === `${REFINE}/${last}`)![0].onProgress).toBe(onProgress);
    expect(requestCalls.count).toBe(0);
  });

  it('skips the download when a refinement file is already stored', async () => {
    const store = fakeWeightStore();
    for (const key of refineKeys) store.stored.set(key, bytesOf(key));
    const isStored = vi.fn(store.isStored);
    const prefetch = create({ load: store.load, isStored });

    prefetch.start();
    await vi.waitFor(() => expect(isStored).toHaveBeenCalledTimes(refineKeys.length));
    await tick();
    expect(store.load).not.toHaveBeenCalled();
    expect(prefetch.residentIds()).toEqual([]);
  });

  it('cancels the remaining warms after the first failed persist (at most one wasted download)', async () => {
    requestCalls.count = 0;
    const store = fakeWeightStore({ persist: false });
    const prefetch = create({ load: store.load, isStored: store.isStored });

    prefetch.start();
    await vi.waitFor(() => expect(store.network).toHaveLength(1));
    await tick();
    await tick();
    expect(store.network).toHaveLength(1);

    for (const file of refineFiles) await prefetch.fetch(requestFor(file));
    expect(store.network).toHaveLength(refineKeys.length + 1);
    expect(requestCalls.count).toBe(0);
  });

  it('never starts when the weight store cannot persist', async () => {
    const store = fakeWeightStore();
    const isStored = vi.fn(store.isStored);
    const prefetch = create({ load: store.load, isStored, canPersist: () => false });

    prefetch.start();
    await tick();
    expect(isStored).not.toHaveBeenCalled();
    expect(store.load).not.toHaveBeenCalled();
  });

  it('starts no warm under memory pressure, and stops the chain when pressure arrives', async () => {
    const pressured = fakeWeightStore();
    create({ load: pressured.load, isStored: pressured.isStored, shouldThrottle: () => true }).start();
    await tick();
    expect(pressured.load).not.toHaveBeenCalled();

    let pressure = false;
    const store = fakeWeightStore();
    const load = vi.fn(async (opts: FetchOptions) => {
      const bytes = await store.load(opts);
      pressure = true;
      return bytes;
    });
    create({ load, isStored: store.isStored, shouldThrottle: () => pressure }).start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await tick();
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('aborts the in-flight warm, starts no further one and drops its records on dispose', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn(
      (opts: FetchOptions) =>
        new Promise<ArrayBuffer>((_resolve, reject) => {
          const signal = opts.signal!;
          signals.push(signal);
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const prefetch = create({ load, isStored: async () => false });

    prefetch.start();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);

    prefetch.dispose();
    expect(signals[0]!.aborted).toBe(true);
    await tick();
    expect(prefetch.residentIds()).toEqual([]);

    prefetch.start(); // no-op after dispose
    await tick();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
