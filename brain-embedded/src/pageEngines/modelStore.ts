/**
 * THE local model store — the ONE API the picker drives for every on-device model a page
 * engine can run, whichever engine and whichever cache holds it.
 *
 * Each catalog row's `source` picks the backend: an `hf-file` model streams into our own
 * Cache Storage bucket (`hfModelStore`); a `webllm` model goes through WebLLM's own cache
 * APIs. The picker never sees the difference: it lists rows with a state (`absent`,
 * `downloading`, `ready`, `unsupported`), starts and cancels downloads, removes models
 * and subscribes to changes. A finished download or a removal invalidates the engines'
 * memoized probes, so the very next turn can be served by the new model.
 *
 * Downloads start only here (PRD 34 §3.4) — a chat turn never downloads.
 */

import {
  LOCAL_MODEL_CATALOG,
  localModelFit,
  type LocalBackend,
  type LocalCatalogModel,
  type LocalDeviceSupport,
  type LocalModelUnfit,
  type LocalRuntimeId,
} from '@builderforce/local-inference';
import { reportPageEngineFailure } from './engineFailure';
import type { HfModelStore } from './hfModelStore';
import type { PageEngine } from './types';
import type { WebLlmModelCache } from './webllmEngine';

export type LocalModelState = 'absent' | 'downloading' | 'ready' | 'unsupported';

export type LocalModelRow = LocalCatalogModel & {
  state: LocalModelState;
  /** Where it runs on this device (the fit's choice), when it can: `webgpu` or the
   *  engine's `cpu`. The picker labels `bfi` rows by it. */
  backend?: LocalBackend;
  /** 0..1 while `downloading`. */
  progress?: number;
  /** Why it is `unsupported`: a fit code, or `engine_unavailable` when this host does not
   *  carry the engine. */
  reason?: LocalModelUnfit | 'engine_unavailable';
  /** An `unsupported` row whose bytes are still cached here — listed, and removable. */
  downloaded?: boolean;
};

export interface LocalModelStore {
  listLocalModels(): Promise<LocalModelRow[]>;
  /** Start (or join) a download. Rejects with the failure; the row returns to `absent`. */
  download(ref: string, onProgress?: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
  remove(ref: string): Promise<void>;
  /** Notified on every state or progress change; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}

export interface LocalModelStoreOptions {
  /** The `hf-file` backend (Bonsai on `bfi`). */
  hf?: HfModelStore;
  /** The WebLLM backend (`createWebLlmEngine(...).models`). */
  webllm?: WebLlmModelCache;
  /** Each engine's device support — a runtime absent here is `engine_unavailable`. Never
   *  rejects: a failure reads as an unsupported record carrying its reason
   *  (`webGpuSupport`, `BfiPageEngine.support`). */
  support: Partial<Record<LocalRuntimeId, () => Promise<LocalDeviceSupport>>>;
  /** Engines whose probes a download or removal invalidates. */
  engines?: readonly Pick<PageEngine, 'invalidate'>[];
  catalog?: readonly LocalCatalogModel[];
}

/** One backend's view of a model, by the row's source. */
interface Backend {
  ready(row: LocalCatalogModel): Promise<boolean>;
  download(row: LocalCatalogModel, onProgress: (fraction: number) => void, signal?: AbortSignal): Promise<void>;
  remove(row: LocalCatalogModel): Promise<void>;
}

function backendFor(row: LocalCatalogModel, options: LocalModelStoreOptions): Backend | undefined {
  const { hf, webllm } = options;
  if (row.source.kind === 'hf-file') {
    return hf
      ? {
          ready: async (r) => (await hf.status(r.ref)) === 'ready',
          download: (r, onProgress, signal) => hf.download(r.ref, onProgress, signal),
          remove: (r) => hf.remove(r.ref),
        }
      : undefined;
  }
  const { modelId } = row.source;
  return webllm
    ? {
        ready: () => webllm.has(modelId),
        download: (_r, onProgress, signal) => webllm.download(modelId, onProgress, signal),
        remove: () => webllm.remove(modelId),
      }
    : undefined;
}

export function createLocalModelStore(options: LocalModelStoreOptions): LocalModelStore {
  const catalog = options.catalog ?? LOCAL_MODEL_CATALOG;
  const listeners = new Set<() => void>();
  const inFlight = new Map<string, { progress: number; done: Promise<void> }>();
  const emit = (): void => {
    for (const listener of listeners) listener();
  };
  const changed = (): void => {
    for (const engine of options.engines ?? []) engine.invalidate();
    emit();
  };
  const rowOf = (ref: string): LocalCatalogModel => {
    const row = catalog.find((m) => m.ref === ref);
    if (!row) throw new Error(`unknown_model: ${ref}`);
    return row;
  };

  async function describe(row: LocalCatalogModel, supports: Map<LocalRuntimeId, LocalDeviceSupport | null>) {
    const pending = inFlight.get(row.ref);
    if (pending) return { ...row, state: 'downloading' as const, progress: pending.progress };
    const backend = backendFor(row, options);
    const support = supports.get(row.runtime);
    if (!backend || !support) return { ...row, state: 'unsupported' as const, reason: 'engine_unavailable' as const };
    // Fit first, as the engines' probes do: a model this device cannot run is never
    // offered, even when its bytes are cached (`remove` still clears them).
    const fit = localModelFit(row, support);
    const ready = await backend.ready(row).catch((e: unknown) => {
      reportPageEngineFailure(row.runtime, 'cache_lookup', e);
      return false;
    });
    if (!fit.fits) return { ...row, state: 'unsupported' as const, reason: fit.reason, ...(ready ? { downloaded: true } : {}) };
    return { ...row, state: ready ? ('ready' as const) : ('absent' as const), backend: fit.backend };
  }

  return {
    async listLocalModels() {
      const runtimes = [...new Set(catalog.map((m) => m.runtime))];
      const answers = await Promise.all(
        runtimes.map(async (runtime) => {
          const probe = options.support[runtime];
          return [runtime, probe ? await probe() : null] as const;
        }),
      );
      const supports = new Map<LocalRuntimeId, LocalDeviceSupport | null>(answers);
      return Promise.all(catalog.map((row) => describe(row, supports)));
    },

    download(ref, onProgress, signal) {
      const existing = inFlight.get(ref);
      if (existing) return existing.done;
      const row = rowOf(ref);
      const backend = backendFor(row, options);
      if (!backend) return Promise.reject(new Error(`engine_unavailable: ${row.runtime}`));
      const entry = { progress: 0, done: Promise.resolve() };
      entry.done = backend
        .download(
          row,
          (fraction) => {
            entry.progress = fraction;
            onProgress?.(fraction);
            emit();
          },
          signal,
        )
        .finally(() => {
          inFlight.delete(ref);
          changed();
        });
      inFlight.set(ref, entry);
      emit();
      return entry.done;
    },

    async remove(ref) {
      const row = rowOf(ref);
      await backendFor(row, options)?.remove(row);
      changed();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/**
 * A {@link LocalModelStore} that reaches the real one only when first used — the picker's
 * port in a host whose engines must stay off first paint (the web composer imports them
 * lazily; the editor's webview builds them on first use). `store` is asked per call and
 * memoized by the host; `subscribe` attaches once it resolves, and an unsubscribe that
 * lands first wins, so a listener is never left attached.
 */
export function deferredLocalModelStore(
  store: () => LocalModelStore | Promise<LocalModelStore>,
): LocalModelStore {
  const resolved = async (): Promise<LocalModelStore> => store();
  return {
    listLocalModels: async () => (await resolved()).listLocalModels(),
    download: async (ref, onProgress, signal) => (await resolved()).download(ref, onProgress, signal),
    remove: async (ref) => (await resolved()).remove(ref),
    subscribe(listener) {
      let unsubscribe: (() => void) | undefined;
      let gone = false;
      void resolved().then((real) => {
        if (!gone) unsubscribe = real.subscribe(listener);
      });
      return () => {
        gone = true;
        unsubscribe?.();
      };
    },
  };
}
