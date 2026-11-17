/**
 * WeightPrefetch — warms the IndexedDB weight store with the refinement
 * model's weights once the draft model is up.
 *
 * Wraps `createPrefetcher` from `@seanhogg/builderforce-webcontainers/ml`. The
 * prefetch loader only WARMS the store: it skips a file already stored, else
 * runs `getOrFetchWeight` (which persists the download) and resolves to the
 * byte length, dropping the buffer. Nothing large is ever held by the
 * prefetcher — the multi-GB refinement weights wait in IndexedDB, not in
 * memory, until the refinement engine reads them.
 *
 * `start()` warms the refinement model's ONNX files ONE AT A TIME (explicit
 * `prefetch()` calls chained, `maxConcurrent: 1`), so at most one download's
 * chunks + copy are in memory beside the resident draft sessions. The chain
 * stops for good when:
 *   • the shared SessionResidency reports memory pressure (`shouldThrottle` —
 *     the prefetcher refuses the next warm as 'throttled');
 *   • a download could not be persisted (quota, private mode): the remaining
 *     warms are cancelled, so at most one download is wasted;
 *   • `dispose()` aborts the lifetime signal.
 * It never starts at all when the environment has no IndexedDB. The owner calls
 * `start()` only after the draft engine's init has resolved, so the warm never
 * slows the draft's own downloads and a failed draft never triggers it.
 *
 * The refinement engine fetches through `fetch()`, which NEVER asks the
 * prefetcher to load: a file whose warm has not begun is claimed (the chain
 * skips it) and loaded directly; a file whose warm is in flight is joined —
 * the caller's `onProgress` gets the warm's latest progress and every update
 * until it settles — and then read through `getOrFetchWeight`, a store hit
 * when the warm persisted, a normal download otherwise.
 */

import { createPrefetcher, type Prefetcher, type PrefetchTarget } from '@seanhogg/builderforce-webcontainers/ml';
import type { DiffusionModelId, LcmModelDescriptor, ModelDescriptor, WeightSource } from '../../types';
import { MODEL_REGISTRY } from '../diffusion-models';
import { getOrFetchWeight, type FetchOptions } from '../weight-cache';
import { weightStore } from './weight-store';

/** Where weights come from — the same three fields every weight fetch needs. */
export interface WeightSourceConfig {
  apiKey: string;
  weightSources: WeightSource[];
  r2Base?: string;
}

/** One weight fetch, minus the abort signal (the fetcher supplies that). */
export type WeightRequest = Omit<FetchOptions, 'signal'>;

/** What a DiffusionEngine needs to route its weight fetches through a prefetcher. */
export interface WeightFetcher {
  fetch(request: WeightRequest): Promise<ArrayBuffer>;
}

/** Seams over the weight store and memory budget (defaults are the real ones). */
export interface WeightPrefetchDeps {
  load?: (opts: FetchOptions) => Promise<ArrayBuffer>;
  isStored?: (cacheKey: string) => Promise<boolean>;
  canPersist?: () => boolean;
  /** True while memory is pressured — no further warm starts. */
  shouldThrottle?: () => boolean;
}

type ProgressFn = NonNullable<FetchOptions['onProgress']>;

/** Latest progress of one warm plus the joined fetches listening to it. */
interface WarmProgress {
  latest: [number, number | null] | null;
  listeners: Set<ProgressFn>;
}

/** The one cache-key / source shape for a model file — shared by the engine's
 *  own fetches and the prefetch targets so a warmed file is always found. */
export function weightRequest(
  descriptor: LcmModelDescriptor,
  file: string,
  source: WeightSourceConfig,
): WeightRequest {
  return {
    cacheKey: `${descriptor.id}/${file}`,
    hfRepo: descriptor.hfRepo,
    hfPath: file,
    sources: source.weightSources,
    apiKey: source.apiKey,
    r2Base: source.r2Base,
  };
}

/** Every ONNX path an lcm-diffusion model loads, sidecars included; [] for
 *  other engine families. */
export function modelWeightFiles(descriptor: ModelDescriptor): string[] {
  if (descriptor.engine !== 'lcm-diffusion') return [];
  const { textEncoder, unet, vaeDecoder } = descriptor.files;
  return [textEncoder, unet, vaeDecoder].flatMap((f) => (f.externalData ? [f.model, f.externalData] : [f.model]));
}

function modelTargets(model: DiffusionModelId, source: WeightSourceConfig): PrefetchTarget[] {
  const descriptor = MODEL_REGISTRY[model];
  if (descriptor.engine !== 'lcm-diffusion') return [];
  return modelWeightFiles(descriptor).map((file) => {
    const request = weightRequest(descriptor, file, source);
    return { id: request.cacheKey, bytes: 0, kind: 'weights', meta: { request } };
  });
}

export class WeightPrefetch implements WeightFetcher {
  private readonly prefetcher: Prefetcher;
  private readonly lifetime = new AbortController();
  private readonly targets: PrefetchTarget[];
  private readonly load: (opts: FetchOptions) => Promise<ArrayBuffer>;
  private readonly canPersist: () => boolean;
  /** Ids queued for a warm that neither began nor was claimed by a fetch. */
  private readonly pending = new Set<string>();
  private readonly progress = new Map<string, WarmProgress>();
  /** The one warm in flight (warms are sequential). */
  private active: { id: string; done: Promise<void> } | null = null;
  private started = false;
  private stopped = false;

  constructor(refinementModel: DiffusionModelId, source: WeightSourceConfig, deps: WeightPrefetchDeps = {}) {
    this.load = deps.load ?? getOrFetchWeight;
    this.canPersist = deps.canPersist ?? (() => weightStore().canPersist());
    const isStored = deps.isStored ?? ((key: string) => weightStore().has(key));
    this.targets = modelTargets(refinementModel, source);
    this.prefetcher = createPrefetcher({
      // Warm only: resolve to a byte count so no buffer stays resident here.
      loader: async (target, signal) => {
        const request = (target.meta as { request?: WeightRequest } | undefined)?.request;
        if (!request) throw new Error(`WeightPrefetch: unknown weight target '${target.id}'`);
        if (await isStored(request.cacheKey)) return 0;
        const progress = this.progressOf(target.id);
        const bytes = await this.load({
          ...request,
          signal,
          onProgress: (loaded, total) => {
            progress.latest = [loaded, total];
            for (const listener of progress.listeners) listener(loaded, total);
          },
          onPersistFailed: () => this.stop('weight store cannot persist'),
        });
        return bytes.byteLength;
      },
      targets: this.targets,
      maxConcurrent: 1,
      shouldThrottle: deps.shouldThrottle,
    });
  }

  /** Start warming the refinement model's files, one at a time. Call after the
   *  draft engine's init resolved. No-op when repeated, after dispose, or when
   *  the weight store cannot persist (a warm would only be thrown away). */
  start(): void {
    if (this.started || this.stopped || this.lifetime.signal.aborted || !this.canPersist()) return;
    this.started = true;
    for (const target of this.targets) this.pending.add(target.id);
    void this.targets.reduce<Promise<void>>((chain, target) => chain.then(() => this.warm(target)), Promise.resolve());
  }

  private async warm(target: PrefetchTarget): Promise<void> {
    if (!this.pending.delete(target.id) || this.stopped || this.lifetime.signal.aborted) return;
    const done = this.prefetcher.prefetch(target, { signal: this.lifetime.signal }).then((outcome) => {
      // 'throttled' covers memory pressure: stop warming; the refinement fetch
      // simply downloads later.
      if (outcome === 'throttled') this.stopped = true;
    });
    this.active = { id: target.id, done };
    try {
      await done;
    } finally {
      this.active = null;
      this.progress.delete(target.id);
      this.prefetcher.release(target.id);
    }
  }

  /** Fetch one weight file: join its in-flight warm (forwarding the warm's
   *  progress), else claim it from the queue; then read it through the store. */
  async fetch(request: WeightRequest): Promise<ArrayBuffer> {
    const key = request.cacheKey;
    this.pending.delete(key);
    const active = this.active;
    if (active?.id === key) {
      const unsubscribe = request.onProgress ? this.subscribe(key, request.onProgress) : undefined;
      try {
        await active.done; // its outcome does not matter: the load below covers a failed warm
      } finally {
        unsubscribe?.();
      }
    }
    return this.load({ ...request, signal: this.lifetime.signal });
  }

  private progressOf(id: string): WarmProgress {
    let entry = this.progress.get(id);
    if (!entry) {
      entry = { latest: null, listeners: new Set() };
      this.progress.set(id, entry);
    }
    return entry;
  }

  private subscribe(id: string, listener: ProgressFn): () => void {
    const entry = this.progressOf(id);
    if (entry.latest) listener(...entry.latest);
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  /** Stop warming: nothing further starts, anything in flight is cancelled. */
  private stop(reason: string): void {
    this.stopped = true;
    this.pending.clear();
    this.prefetcher.cancelAll(reason);
  }

  /** Ids the prefetcher still holds a (byte-count) record for — diagnostics / tests. */
  residentIds(): string[] {
    return this.prefetcher.residentIds();
  }

  /** Abort every in-flight warm and drop every record. Idempotent. */
  dispose(): void {
    this.lifetime.abort();
    this.stop('engine disposed');
    for (const id of this.prefetcher.residentIds()) this.prefetcher.release(id);
  }
}
