import { describe, expect, it, vi } from 'vitest';
import { MODEL_REGISTRY } from '../diffusion-models';
import type { LcmModelDescriptor } from '../../types';
import type { FetchOptions } from '../weight-cache';
import { EngineActivity } from './engine-activity';
import { WeightPrefetch, modelWeightFiles, weightRequest, type WeightPrefetchDeps } from './weight-prefetch';
import type { WeightSourceConfig } from './weight-prefetch';

/**
 * Refinement weights are WARMED into the weight store one file at a time and
 * only while the engine is idle (never held in memory by the prefetcher, never
 * demand-loaded by it). Generation cancels an in-flight warm, which resumes on
 * the next idle; pressure pauses the warm; a file too large for the budget
 * headroom is skipped; a failed persist is retried once; and the warm never
 * runs without IndexedDB or after dispose.
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
const ticks = async (n = 4) => {
  for (let i = 0; i < n; i++) await tick();
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => (resolve = res));
  return { promise, resolve };
}

/** A load that hangs until its signal aborts, then rejects (after `settle`, when given). */
function hangUntilAborted(opts: FetchOptions, settle?: Promise<void>): Promise<ArrayBuffer> {
  return new Promise<ArrayBuffer>((_resolve, reject) => {
    opts.signal!.addEventListener('abort', () => {
      void (settle ?? Promise.resolve()).then(() => reject(new DOMException('aborted', 'AbortError')));
    });
  });
}

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

function create(deps: Partial<WeightPrefetchDeps>): WeightPrefetch {
  return new WeightPrefetch(REFINE, SOURCE, {
    activity: new EngineActivity(),
    headroomBytes: () => Number.POSITIVE_INFINITY,
    canPersist: () => true,
    ...deps,
  });
}

const requestFor = (file: string, onProgress?: FetchOptions['onProgress']) => ({
  ...weightRequest(refineDescriptor, file, SOURCE),
  onProgress,
});

/** One complete generation: idle → busy → idle. */
const busyCycle = (activity: EngineActivity) => activity.run(async () => tick());

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

  it('starts no warm while the engine is busy, and warms once it goes idle', async () => {
    const activity = new EngineActivity();
    const store = fakeWeightStore();
    const isStored = vi.fn(store.isStored);
    const gate = deferred();
    const generation = activity.run(() => gate.promise);

    create({ activity, load: store.load, isStored }).start();
    await ticks();
    expect(isStored).not.toHaveBeenCalled();
    expect(store.load).not.toHaveBeenCalled();

    gate.resolve();
    await generation;
    await vi.waitFor(() => expect(store.stored.size).toBe(refineKeys.length));
  });

  it('starts no warm when a second generation begins right after the first ends', async () => {
    const activity = new EngineActivity();
    const store = fakeWeightStore();
    const g1 = deferred();
    const g2 = deferred();
    const back = activity.run(() => g1.promise).then(() => activity.run(() => g2.promise));

    create({ activity, load: store.load, isStored: store.isStored }).start();
    g1.resolve();
    await ticks();
    expect(activity.isBusy()).toBe(true);
    expect(store.load).not.toHaveBeenCalled();

    g2.resolve();
    await back;
    await vi.waitFor(() => expect(store.stored.size).toBe(refineKeys.length));
  });

  it('cancels an in-flight warm when generation starts and resumes it on the next idle', async () => {
    const activity = new EngineActivity();
    const store = fakeWeightStore();
    const signals: AbortSignal[] = [];
    const load = vi.fn((opts: FetchOptions) => {
      if (opts.cacheKey === refineKeys[0] && signals.length === 0) {
        signals.push(opts.signal!);
        return hangUntilAborted(opts);
      }
      return store.load(opts);
    });
    create({ activity, load, isStored: store.isStored }).start();
    await vi.waitFor(() => expect(signals).toHaveLength(1));

    const gate = deferred();
    const generation = activity.run(() => gate.promise);
    expect(signals[0]!.aborted).toBe(true);
    await ticks();
    expect(load).toHaveBeenCalledTimes(1); // nothing further while busy

    gate.resolve();
    await generation;
    await vi.waitFor(() => expect(store.stored.size).toBe(refineKeys.length));
    expect(store.network.filter((k) => k === refineKeys[0])).toHaveLength(1);
  });

  it('pauses under memory pressure and resumes after the next idle transition', async () => {
    const activity = new EngineActivity();
    const store = fakeWeightStore();
    let pressure = true;
    create({ activity, load: store.load, isStored: store.isStored, isPressured: () => pressure }).start();
    await ticks();
    expect(store.load).not.toHaveBeenCalled();

    pressure = false;
    await ticks();
    expect(store.load).not.toHaveBeenCalled(); // re-checks only at the next idle

    await busyCycle(activity);
    await vi.waitFor(() => expect(store.stored.size).toBe(refineKeys.length));
  });

  it('aborts and skips a file whose size exceeds half the budget headroom', async () => {
    const store = fakeWeightStore();
    const bigSignals: AbortSignal[] = [];
    const load = vi.fn((opts: FetchOptions) => {
      if (opts.cacheKey === refineKeys[0]) {
        bigSignals.push(opts.signal!);
        const download = hangUntilAborted(opts);
        opts.onProgress?.(0, 60); // 60 × 2 > 100
        return download;
      }
      opts.onProgress?.(0, 50); // 50 × 2 = 100: fits
      return store.load(opts);
    });
    create({ load, isStored: store.isStored, headroomBytes: () => 100 }).start();

    await vi.waitFor(() => expect(store.stored.size).toBe(refineKeys.length - 1));
    await ticks();
    expect(bigSignals).toHaveLength(1);
    expect(bigSignals[0]!.aborted).toBe(true);
    expect(store.stored.has(refineKeys[0]!)).toBe(false);
  });

  it('retries a failed persist once at the next idle, then stops for good', async () => {
    requestCalls.count = 0;
    const activity = new EngineActivity();
    const store = fakeWeightStore({ persist: false });
    const prefetch = create({ activity, load: store.load, isStored: store.isStored });

    prefetch.start();
    await vi.waitFor(() => expect(store.network).toHaveLength(1));
    await ticks();
    expect(store.network).toHaveLength(1); // waits for the next idle

    await busyCycle(activity);
    await vi.waitFor(() => expect(store.network).toHaveLength(2));
    expect(store.network).toEqual([refineKeys[0], refineKeys[0]]);

    await busyCycle(activity);
    await ticks();
    expect(store.network).toHaveLength(2); // stopped

    for (const file of refineFiles) await prefetch.fetch(requestFor(file));
    expect(store.network).toHaveLength(refineKeys.length + 2);
    expect(requestCalls.count).toBe(0);
  });

  it('stops at once when a persist fails and the store cannot persist', async () => {
    const activity = new EngineActivity();
    const store = fakeWeightStore({ persist: false });
    let canPersist = true;
    const load = vi.fn(async (opts: FetchOptions) => {
      canPersist = false;
      return store.load(opts);
    });
    create({ activity, load, isStored: store.isStored, canPersist: () => canPersist }).start();
    await vi.waitFor(() => expect(store.network).toHaveLength(1));

    await busyCycle(activity);
    await ticks();
    expect(store.network).toHaveLength(1);
  });

  it('fetch claims a pending file and waits for a cancelled warm of its file to settle', async () => {
    const activity = new EngineActivity();
    const store = fakeWeightStore();
    const dying = deferred();
    let hung = false;
    const load = vi.fn((opts: FetchOptions) => {
      if (opts.cacheKey === refineKeys[0] && !hung) {
        hung = true;
        return hangUntilAborted(opts, dying.promise);
      }
      return store.load(opts);
    });
    const prefetch = create({ activity, load, isStored: store.isStored });
    prefetch.start();
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    const first = refineFiles[0]!;
    const last = refineFiles[refineFiles.length - 1]!;
    await activity.run(async () => {
      const pending = prefetch.fetch(requestFor(first));
      await ticks();
      expect(load).toHaveBeenCalledTimes(1); // the cancelled warm is still settling

      dying.resolve();
      expect(new TextDecoder().decode(await pending)).toBe(refineKeys[0]);
      await prefetch.fetch(requestFor(last)); // claimed while still queued
    });

    await vi.waitFor(() => expect(store.stored.size).toBe(refineKeys.length));
    await ticks();
    expect(store.network.filter((k) => k === refineKeys[0])).toHaveLength(1);
    expect(store.network.filter((k) => k === `${REFINE}/${last}`)).toHaveLength(1);
  });

  it('aborts the in-flight warm and starts no further one on dispose', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((opts: FetchOptions) => {
      signals.push(opts.signal!);
      return hangUntilAborted(opts);
    });
    const prefetch = create({ load, isStored: async () => false });

    prefetch.start();
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0]!.aborted).toBe(false);

    prefetch.dispose();
    expect(signals[0]!.aborted).toBe(true);
    await ticks();

    prefetch.start(); // no-op after dispose
    await ticks();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
