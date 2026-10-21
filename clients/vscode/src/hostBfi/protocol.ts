/**
 * What the extension host hands its `bfi` worker. Every frame between them is
 * brain-embedded's: the page-engine frames and the engine-worker lifecycle's
 * (`engineWorker.invalidate` / `engineWorker.fatal`).
 *
 * Pure — no Node imports — shared by `runtime.ts` and `worker.ts`.
 */

export interface HostBfiWorkerData {
  /** Absolute path of the vendored `bfi_web_bg.wasm` copied beside the bundle. */
  wasmPath: string;
  /** The host's model file cache (`globalStorageUri/local-models/bfi`). */
  modelDir: string;
  /** `os.totalmem()` — the worker's wasm cannot read the machine's RAM itself. */
  deviceMemoryBytes: number;
}
