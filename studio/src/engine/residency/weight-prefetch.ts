/**
 * WeightPrefetch — warms the IndexedDB weight store with the refinement
 * model's weights while the engine is idle.
 *
 * Wraps `createPrefetcher` from `@seanhogg/builderforce-webcontainers/ml`. The
 * prefetch loader only WARMS the store: it skips a file already stored, else
 * runs `getOrFetchWeight` (which persists the download) and resolves to the
 * byte length, dropping the buffer. The multi-GB refinement weights wait in
 * IndexedDB, not in memory, until the refinement engine reads them.
 *
 * Warms run ONE AT A TIME and ONLY WHILE THE ENGINE IS IDLE (the shared
 * {@link ActivitySignal}), so a download's chunks, its concatenated buffer
 * and the IndexedDB structured clone never sit in memory beside a running
 * generation:
 *   • before each file the warm waits for idle; while the session budget is
 *     pressured it pauses until the next idle transition and re-checks;
 *   • when generation starts mid-warm, that warm is cancelled and requeued —
 *     it restarts on the next idle;
 *   • once a download's total size is known, a file needing more than half the
 *     budget headroom (`total × 2 > headroomBytes()`) is aborted and skipped —
 *     the refinement engine simply downloads it on demand;
 *   • any admission refusal from the prefetcher ('throttled', 'skipped', …)
 *     pauses until the next idle, never stops the warm;
 *   • a download that could not be persisted is retried once at the next idle
 *     when the store still reports it can persist (a transiently blocked
 *     open); a second failure, or a store that cannot persist, stops the warm
 *     for good;
 *   • `dispose()` aborts the lifetime signal.
 * It never starts when the environment has no IndexedDB. The owner calls
 * `start()` only after the draft engine's init has resolved.
 *
 * The refinement engine fetches through `fetch()`, which NEVER asks the
 * prefetcher to load: it claims the file (no warm of it starts afterwards),
 * waits for a still-settling warm of that file (cancelled when generation
 * began) so a dying download never overlaps the real one, then reads it
 * through `getOrFetchWeight` — a store hit when a warm persisted it.
 */

import {
  createPrefetcher,
  type Prefetcher,
  type PrefetchOutcome,
  type PrefetchTarget,
} from '@seanhogg/builderforce-webcontainers/ml';
import type { DiffusionModelId, LcmModelDescriptor, ModelDescriptor, WeightSource } from '../../types';
import { MODEL_REGISTRY } from '../diffusion-models';
import { getOrFetchWeight, type FetchOptions } from '../weight-cache';
import type { ActivitySignal } from './engine-activity';
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

/** The engine's activity and memory budget, plus seams over the weight store
 *  (store defaults are the real ones). */
export interface WeightPrefetchDeps {
  /** Warms run only while this reports idle. */
  activity: ActivitySignal;
  /** Session-budget bytes not held by live sessions. */
  headroomBytes: () => number;
  /** True while memory is pressured — the warm pauses. */
  isPressured?: () => boolean;
  load?: (opts: FetchOptions) => Promise<ArrayBuffer>;
  isStored?: (cacheKey: string) => Promise<boolean>;
  canPersist?: () => boolean;
}

/** The one warm in flight (warms are sequential) and what happened to it. */
interface ActiveWarm {
  id: string;
  /** Resolves once the warm's load has settled; never rejects. */
  settled: Promise<void>;
  cancelledByBusy: boolean;
  tooLarge: boolean;
  persistFailed: boolean;
}

/** What the warm loop does after one warm. */
type WarmResult = 'done' | 'skip' | 'requeue' | 'pause' | 'persist-failed';

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
  private readonly activity: ActivitySignal;
  private readonly headroomBytes: () => number;
  private readonly isPressured: () => boolean;
  private readonly load: (opts: FetchOptions) => Promise<ArrayBuffer>;
  private readonly isStored: (cacheKey: string) => Promise<boolean>;
  private readonly canPersist: () => boolean;
  /** Targets still to warm, in order. */
  private queue: PrefetchTarget[] = [];
  /** Ids a fetch has claimed — never warmed (or requeued) again. */
  private readonly claimed = new Set<string>();
  /** Ids already retried after a failed persist. */
  private readonly retried = new Set<string>();
  private active: ActiveWarm | null = null;
  private started = false;
  private stopped = false;

  constructor(refinementModel: DiffusionModelId, source: WeightSourceConfig, deps: WeightPrefetchDeps) {
    this.activity = deps.activity;
    this.headroomBytes = deps.headroomBytes;
    this.isPressured = deps.isPressured ?? (() => false);
    this.load = deps.load ?? getOrFetchWeight;
    this.isStored = deps.isStored ?? ((key: string) => weightStore().has(key));
    this.canPersist = deps.canPersist ?? (() => weightStore().canPersist());
    this.targets = modelTargets(refinementModel, source);
    this.prefetcher = createPrefetcher({
      loader: (target, signal) => this.warmLoad(target, signal),
      targets: this.targets,
      maxConcurrent: 1,
    });
  }

  private get halted(): boolean {
    return this.stopped || this.lifetime.signal.aborted;
  }

  /** Start warming the refinement model's files, one at a time, while idle.
   *  Call after the draft engine's init resolved. No-op when repeated, after
   *  dispose, or when the weight store cannot persist. */
  start(): void {
    if (this.started || this.halted || !this.canPersist()) return;
    this.started = true;
    this.queue = [...this.targets];
    void this.drain();
  }

  private async drain(): Promise<void> {
    while (!this.halted) {
      const target = this.queue[0];
      if (!target) return;
      await this.untilIdle();
      if (this.halted) return;
      // A new generation may have started between the idle signal and now.
      if (this.activity.isBusy()) continue;
      if (this.queue[0] !== target) continue; // claimed by a fetch meanwhile
      if (this.isPressured()) {
        await this.nextIdle();
        continue;
      }
      this.queue.shift();
      const result = await this.warm(target);
      if (this.halted) return;
      if (result === 'requeue') {
        this.requeue(target); // generation began: the loop's idle wait waits it out
      } else if (result === 'pause') {
        this.requeue(target);
        await this.nextIdle();
      } else if (result === 'persist-failed') {
        if (this.retried.has(target.id) || !this.canPersist()) {
          this.stop('weight store cannot persist');
          return;
        }
        this.retried.add(target.id);
        this.requeue(target);
        await this.nextIdle();
      }
    }
  }

  private requeue(target: PrefetchTarget): void {
    if (!this.claimed.has(target.id)) this.queue.unshift(target);
  }

  private async warm(target: PrefetchTarget): Promise<WarmResult> {
    const warm: ActiveWarm = {
      id: target.id,
      settled: Promise.resolve(),
      cancelledByBusy: false,
      tooLarge: false,
      persistFailed: false,
    };
    const offBusy = this.activity.onBusy(() => {
      warm.cancelledByBusy = true;
      this.prefetcher.cancel(target.id);
    });
    // Backstop: never start a download beside a generation that is already running.
    if (this.activity.isBusy()) {
      offBusy();
      return 'requeue';
    }
    this.active = warm;
    const outcome = this.prefetcher.prefetch(target, { signal: this.lifetime.signal });
    warm.settled = outcome.then(() => undefined);
    try {
      return classify(await outcome, warm);
    } finally {
      offBusy();
      if (this.active === warm) this.active = null;
      this.prefetcher.release(target.id);
    }
  }

  /** The prefetch loader: warm one file into the store, resolving to its size
   *  so no buffer stays resident in the prefetcher. */
  private async warmLoad(target: PrefetchTarget, signal: AbortSignal): Promise<number> {
    const request = (target.meta as { request?: WeightRequest } | undefined)?.request;
    if (!request) throw new Error(`WeightPrefetch: unknown weight target '${target.id}'`);
    const warm = this.active?.id === target.id ? this.active : null;
    if (await this.isStored(request.cacheKey)) return 0;
    signal.throwIfAborted();
    const bytes = await this.load({
      ...request,
      signal,
      onProgress: (_loaded, total) => {
        // Too large to hold beside the live sessions: leave it to the on-demand fetch.
        if (warm && !warm.tooLarge && total !== null && total * 2 > this.headroomBytes()) {
          warm.tooLarge = true;
          this.prefetcher.cancel(target.id);
        }
      },
      onPersistFailed: () => {
        if (warm) warm.persistFailed = true;
      },
    });
    return bytes.byteLength;
  }

  /** Fetch one weight file: claim it from the warm queue, wait out a warm of
   *  it that is still settling, then read it through the store. */
  async fetch(request: WeightRequest): Promise<ArrayBuffer> {
    const key = request.cacheKey;
    this.claimed.add(key);
    this.queue = this.queue.filter((target) => target.id !== key);
    const active = this.active;
    if (active?.id === key) await active.settled;
    return this.load({ ...request, signal: this.lifetime.signal });
  }

  /** Resolves when the engine is idle, or the warm is disposed. */
  private untilIdle(): Promise<void> {
    if (!this.activity.isBusy()) return Promise.resolve();
    return this.abortable((done) => {
      void this.activity.whenIdle().then(done);
      return () => {};
    });
  }

  /** Resolves at the next busy → idle transition (the current one when busy
   *  now), or when the warm is disposed. */
  private nextIdle(): Promise<void> {
    return this.abortable((done) => {
      let off: () => void = () => {};
      const afterBusy = () => {
        off();
        void this.activity.whenIdle().then(done);
      };
      if (this.activity.isBusy()) afterBusy();
      else off = this.activity.onBusy(afterBusy);
      return () => off();
    });
  }

  /** A promise resolved by `arm`'s `done` callback or by dispose, whichever
   *  comes first; `arm` returns its own cleanup. */
  private abortable(arm: (done: () => void) => () => void): Promise<void> {
    const { signal } = this.lifetime;
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let cleanup: () => void = () => {};
      const done = () => {
        cleanup();
        signal.removeEventListener('abort', done);
        resolve();
      };
      signal.addEventListener('abort', done, { once: true });
      cleanup = arm(done);
    });
  }

  /** Stop warming: nothing further starts, anything in flight is cancelled. */
  private stop(reason: string): void {
    this.stopped = true;
    this.queue = [];
    this.prefetcher.cancelAll(reason);
  }

  /** Abort every in-flight warm and drop every record. Idempotent. */
  dispose(): void {
    this.lifetime.abort();
    this.stop('engine disposed');
    for (const id of this.prefetcher.residentIds()) this.prefetcher.release(id);
  }
}

/** Map one prefetch outcome to the warm loop's next move. */
function classify(outcome: PrefetchOutcome, warm: ActiveWarm): WarmResult {
  if (outcome === 'loaded') return warm.persistFailed ? 'persist-failed' : 'done';
  if (outcome === 'cancelled') return warm.cancelledByBusy && !warm.tooLarge ? 'requeue' : 'skip';
  // A failed download is left to the on-demand fetch.
  if (outcome === 'failed') return 'skip';
  // 'throttled' / 'skipped' / 'duplicate': the admission gate refused — retry at the next idle.
  return 'pause';
}
