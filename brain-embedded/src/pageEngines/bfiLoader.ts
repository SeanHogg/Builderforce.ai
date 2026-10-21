/**
 * THE `bfi-web` loader — the one way a `bfi` worker (`runBfiWorker`, the editor host's
 * `hostBfi/worker.ts`) loads the wasm.
 *
 * `@seanhogg/bfi-web` is the vendored wasm-pack build of Synapse's engine (PRD 34 §3.1,
 * `packages/bfi-web`). This module dynamic-imports it, runs its wasm-bindgen initializer
 * with the wasm URL the HOST's bundler emitted — once, however many engines or calls ask
 * — and hands back the `BfiEngine` class in the shape `bfiEngine.ts` takes. Only the URL
 * differs per host (Next asset, Vite `?url`, `chrome.runtime.getURL`, a file's bytes);
 * everything else lives here. `bfi` never runs on a page's own thread: a wasm trap
 * poisons its realm, and only a worker can be replaced.
 *
 * It is its own entry (`@seanhogg/builderforce-brain-embedded/bfi`), never re-exported
 * from the root: `@seanhogg/bfi-web` is not published, so it stays EXTERNAL in this
 * package's build and only a host that links it may import this entry. An embed that
 * imports the root alone never meets the specifier.
 *
 * The entry also carries the `bfi` page engine itself and the `hf-file` URL rule, for a
 * host that runs the engine OUTSIDE a page (the editor's extension host, in a worker,
 * on the CPU backend) over its own file store — React-free, so that worker stays small.
 */

import type { BfiModule } from './bfiEngine';

export { createBfiEngine, type BfiEngineOptions, type BfiModule, type BfiPageEngine } from './bfiEngine';
export { bfiSupportWithoutWasm } from './bfiSupport';
export { hfResolveUrl, type HfModelStore } from './hfModelStore';
export { runBfiWorker, type RunBfiWorkerOptions } from './bfiWorker';
export { servePageEngines, type PageEngineServerIo } from './remote/serve';
export { isWasmTrap, serveEngineWorker, type EngineWorkerEndpoint } from './remote/engineWorker';

/** Where the wasm binary comes from: a URL the host's bundler emitted (a page), or its
 *  bytes (a Node host reads the file — Node's `fetch` has no `file:`). */
export type BfiWasmSource = string | URL | ArrayBuffer | ArrayBufferView;

/** The slice of the wasm-pack `--target web` module this loader uses. */
export interface BfiWebModule extends BfiModule {
  /** wasm-bindgen's initializer: fetches and instantiates the binary at `module_or_path`. */
  default(options: { module_or_path: BfiWasmSource }): Promise<unknown>;
  /** The THREADED artifact only: start the rayon pool of `n` workers. */
  initThreads?(n: number): Promise<number>;
}

/**
 * The THREADED artifact (`packages/bfi-web/threads/`, built on a pinned nightly with
 * atomics), which a host SERVES as plain files — its pool workers find the glue by URL —
 * and the loader imports at runtime. CPU-only: it carries no WebGPU backend.
 */
export interface BfiThreadsSource {
  /** Absolute URL of the threaded glue (`…/threads/bfi_web.js`). */
  moduleUrl: string;
  /** Absolute URL of its wasm (`…/threads/bfi_web_bg.wasm`). */
  wasmUrl: string;
}

export interface BfiLoadOptions {
  /** The threaded artifact, offered when the host serves it. Used only where threads
   *  exist (cross-origin isolated: `SharedArrayBuffer` + `Worker`) and there is no WebGPU
   *  adapter to prefer. */
  threads?: BfiThreadsSource;
  /** Pool size; default `navigator.hardwareConcurrency`. */
  threadCount?: number;
  /** Imports the threaded glue by URL. Injected only by tests. */
  importThreads?: (moduleUrl: string) => Promise<BfiWebModule>;
  /** How long the pool may take to start (default {@link BFI_THREADS_START_TIMEOUT_MS}). */
  threadsTimeoutMs?: number;
}

/** wasm-bindgen-rayon's pool start (`initThreads`) can hang — a helper worker that never
 *  reports in — so it is raced against this. */
export const BFI_THREADS_START_TIMEOUT_MS = 10_000;

/**
 * The threaded artifact applied here and did not start. Its instance may already exist
 * in this realm, and a realm never holds two wasm instances, so the default artifact is
 * NOT loaded beside it: the host replaces the worker with a single-threaded one
 * (`runBfiWorker` reports it; `createBfiWorkerEngine` respawns without `threads`).
 */
export class BfiThreadsError extends Error {
  constructor(message: string) {
    super(`bfi_threads_failed: ${message}`);
    this.name = 'BfiThreadsError';
  }
}

/** Whether `e` is a {@link BfiThreadsError} (by name: it may cross a realm). */
export const isBfiThreadsError = (e: unknown): boolean => e instanceof Error && e.name === 'BfiThreadsError';

/**
 * Wasm threads need `SharedArrayBuffer`, which a browser grants only to a
 * cross-origin-isolated context, and a `Worker` to spawn the pool from.
 */
function canUseBfiThreads(scope: object = globalThis): boolean {
  const g = scope as { crossOriginIsolated?: boolean; SharedArrayBuffer?: unknown; Worker?: unknown };
  return g.crossOriginIsolated === true && typeof g.SharedArrayBuffer === 'function' && typeof g.Worker === 'function';
}

/** Whether a WebGPU adapter exists here — the default artifact then wins (GPU first). */
async function hasWebGpuAdapter(): Promise<boolean> {
  const gpu = (globalThis as { navigator?: { gpu?: { requestAdapter(): Promise<unknown> } } }).navigator?.gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) != null;
  } catch {
    return false;
  }
}

/** A host-served URL, never resolved by the bundler: imported at runtime as is. */
const importByUrl = (moduleUrl: string): Promise<BfiWebModule> =>
  import(/* webpackIgnore: true */ /* @vite-ignore */ moduleUrl) as Promise<BfiWebModule>;

/** Imports the package. Injected only by tests; a host never passes it. */
export type BfiWebImporter = () => Promise<BfiWebModule>;

const importBfiWeb: BfiWebImporter = () => import('@seanhogg/bfi-web') as unknown as Promise<BfiWebModule>;

let loaded: Promise<BfiModule> | undefined;
let loadedFrom: string | undefined;

/**
 * Load `bfi-web` with its binary at `wasmUrl`, initializing the wasm once per worker.
 * With `options.threads`, a cross-origin-isolated context without a WebGPU adapter loads
 * the THREADED artifact instead and starts its rayon pool
 * (`initThreads(navigator.hardwareConcurrency)`, raced against
 * {@link BFI_THREADS_START_TIMEOUT_MS}); one that fails or times out rejects with
 * {@link BfiThreadsError} — never a second instance in this realm. A failed load is not
 * cached, so a later call (a retry after going online) tries again.
 */
export function loadBfiWeb(
  wasmUrl: BfiWasmSource,
  importer: BfiWebImporter = importBfiWeb,
  options: BfiLoadOptions = {},
): Promise<BfiModule> {
  const url = typeof wasmUrl === 'string' || wasmUrl instanceof URL ? String(wasmUrl) : 'wasm bytes';
  if (loaded) {
    // One wasm instance per page: a second URL cannot re-initialize it, and silently
    // serving the first binary under the second's name would hide a host wiring bug.
    if (loadedFrom !== url) console.warn(`bfi-web already initialized from ${loadedFrom}; ignoring ${url}`);
    return loaded;
  }
  loadedFrom = url;
  const attempt = (async (): Promise<BfiModule> => {
    const threaded = await loadThreaded(options);
    if (threaded) return threaded;
    const module = await importer();
    await module.default({ module_or_path: wasmUrl });
    return { BfiEngine: module.BfiEngine };
  })();
  loaded = attempt;
  attempt.catch(() => {
    if (loaded === attempt) {
      loaded = undefined;
      loadedFrom = undefined;
    }
  });
  return attempt;
}

/** `promise`, or a rejection after `ms` — the timer never outlives the race. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The threaded artifact with its pool started, or null when it does not apply here.
 *  Rejects with {@link BfiThreadsError} when it applies and does not start. */
async function loadThreaded(options: BfiLoadOptions): Promise<BfiModule | null> {
  const { threads } = options;
  if (!threads || !canUseBfiThreads() || (await hasWebGpuAdapter())) return null;
  try {
    const module = await (options.importThreads ?? importByUrl)(threads.moduleUrl);
    await module.default({ module_or_path: threads.wasmUrl });
    const cores = (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency;
    const pool = module.initThreads?.(Math.max(1, options.threadCount ?? cores ?? 1));
    if (pool) await withTimeout(pool, options.threadsTimeoutMs ?? BFI_THREADS_START_TIMEOUT_MS, 'initThreads');
    return { BfiEngine: module.BfiEngine };
  } catch (e) {
    throw new BfiThreadsError(e instanceof Error ? e.message : String(e));
  }
}

/**
 * Forget the initialized module — after a wasm trap poisoned it. The next `loadBfiWeb`
 * imports and initializes again; in practice the realm is a worker that is about to be
 * replaced (the glue keeps its instance per realm), so this only guarantees nothing here
 * hands the poisoned module out again.
 */
export function forgetBfiWeb(): void {
  loaded = undefined;
  loadedFrom = undefined;
}
