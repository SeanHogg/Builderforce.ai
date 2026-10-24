/**
 * `bfi` WITHOUT the chat panel — the registry's `fallbackReach: 'host'` (PRD 34 §3.1) —
 * and the editor's ONE CPU engine.
 *
 * The extension host runs the same `bfi-web` wasm itself, CPU backend, in a
 * `worker_threads` worker (`worker.ts`), and offers it to the page-engine bridge as a
 * port that serves only the host-fallback runtimes. The bridge asks a webview first,
 * which offers a Bonsai row only when it runs on WebGPU; every CPU turn — panel open or
 * closed — lands here, so the chat UI's thread never decodes on the CPU and one CPU copy
 * of a model is resident. `resolveModelRoute` and the local-first probe read
 * `hostPageEngines.connected(runtime)` and need no branch for it.
 *
 * The worker's life is brain-embedded's ONE engine-worker lifecycle
 * (`createEngineWorker`): started on the first request, respawned after a crash or a wasm
 * trap, torn down after five idle minutes. The port is attached only while the host's
 * file cache holds a model for one of these runtimes; that cache is the editor's ONE copy
 * (`files`, the model-file frames the webview's store uses), so a download re-attaches.
 *
 * The webview's picker needs this engine's record too — a model that fits only the
 * CPU is downloaded from there and served here — so `files` answers `modelFile.support`
 * without starting the worker: from the native engine's own probe when this build ships
 * the addon (its GPU, its RAM — cheap, no wasm), else from what the host can read
 * without the wasm (`bfiSupportWithoutWasm` over `os.totalmem()`).
 *
 * With the native engine (`nativeEngine.ts`) the worker serves the GPU too, and its port
 * is PREFERRED on the bridge: it owns a Bonsai row even while a webview could serve it.
 */
import * as os from "node:os";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import { HOST_FALLBACK_RUNTIMES, localCatalogFor, type LocalDeviceSupport } from "@builderforce/local-inference";
import { createEngineWorker, type EngineWorkerHandle } from "@seanhogg/builderforce-brain-embedded";
import { bfiSupportWithoutWasm, type BfiModule } from "@seanhogg/builderforce-brain-embedded/bfi";
import type { HostPageEngineBridge, PageEnginePort } from "../pageEngineBridge";
import { createModelFileServer, type ModelFileServer } from "./modelFileServer";
import { createFileModelStore, type FileModelStore } from "./modelFiles";
import { loadNativeBfi, nativeAddonPath } from "./nativeEngine";
import type { HostBfiWorkerData } from "./protocol";

export interface HostBfiRuntimeOptions {
  /** The extension's install directory (`context.extensionPath`). */
  extensionPath: string;
  /** `context.globalStorageUri.fsPath`. */
  storagePath: string;
  bridge: HostPageEngineBridge;
  /** Injected by tests. */
  store?: FileModelStore;
  /** The native addon's path (`null` = none); default: detected in `out/`. */
  nativePath?: string | null;
  /** Loads the addon; injected by tests. */
  loadNative?: typeof loadNativeBfi;
  spawn?: (script: string, data: HostBfiWorkerData) => Pick<Worker, "postMessage" | "on" | "terminate">;
  /** Idle teardown (default the lifecycle's five minutes). */
  idleMs?: number;
}

export interface HostBfiRuntime {
  /** Re-read the cache and attach / detach the port to match. Serialized: a call while
   *  one runs queues exactly one follow-up. */
  refresh(): Promise<void>;
  /** The cache as the webview's model store sees it (the panel answers its frames). */
  readonly files: ModelFileServer;
  /** The cache itself — where a provisioned model lands (`provision.ts`). */
  readonly store: FileModelStore;
  /** The engine runs natively (`@seanhogg/bfi-node`) rather than as wasm. Reading it
   *  loads the addon (once). */
  readonly native: boolean;
  /** This engine's device record, without starting the worker. */
  support(): Promise<LocalDeviceSupport>;
  dispose(): void;
}

/** The bundle entries esbuild writes beside `out/extension.js`. */
export const HOST_BFI_WORKER_FILE = "bfiHostWorker.js";
export const HOST_BFI_WASM_FILE = "bfi_web_bg.wasm";

/** A cold host worker compiles the wasm and reads the cache before its first answer, so
 *  its probes wait longer than a webview's. */
export const HOST_BFI_PROBE_TIMEOUT_MS = 10_000;

const RUNTIMES = HOST_FALLBACK_RUNTIMES.map((r) => r.id);
const REFS = RUNTIMES.flatMap((runtime) => localCatalogFor(runtime).filter((m) => m.source.kind === "hf-file").map((m) => m.ref));

export function installHostBfiRuntime(options: HostBfiRuntimeOptions): HostBfiRuntime {
  const out = path.join(options.extensionPath, "out");
  const addon = options.nativePath === undefined ? nativeAddonPath(out) : (options.nativePath ?? undefined);
  // Loaded once, on first need: attaching the port (a Bonsai is cached — at activation
  // too, since the port's rank depends on it), a support read, the worker's spawn, or a
  // turn asking whether to provision. With nothing cached and no local turn, the addon
  // is never mapped. "Native" is claimed only when it really loads on this machine: a
  // worker that fell back to the wasm must not outrank a webview's WebGPU.
  let loaded: { module: BfiModule | null } | undefined;
  const nativeModule = (): BfiModule | null =>
    (loaded ??= {
      module: (options.loadNative ?? loadNativeBfi)(addon, (error) =>
        console.error("[bfi] the native engine did not load; the host worker runs the wasm:", error),
      ),
    }).module;
  const nativePath = (): string | undefined => (nativeModule() ? addon : undefined);
  const data: HostBfiWorkerData = {
    wasmPath: path.join(out, HOST_BFI_WASM_FILE),
    modelDir: path.join(options.storagePath, "local-models", "bfi"),
    deviceMemoryBytes: os.totalmem(),
  };
  const store = options.store ?? createFileModelStore(data.modelDir);
  const spawnWorker = options.spawn ?? ((script, workerData) => new Worker(script, { workerData }));
  let detach: (() => void) | undefined;
  let disposed = false;

  const worker = createEngineWorker({
    spawn(events): EngineWorkerHandle {
      const native = nativePath();
      const w = spawnWorker(path.join(out, HOST_BFI_WORKER_FILE), native ? { ...data, nativePath: native } : data);
      w.on("message", (message: unknown) => events.onMessage(message));
      w.on("error", (e: Error) => events.onGone(e.message));
      w.on("exit", (code: number) => events.onGone(`exit ${code}`));
      return { post: (message) => w.postMessage(message), terminate: () => void w.terminate() };
    },
    onMessage: (message) => options.bridge.receive(message),
    // The bridge keyed what was in flight by the stable port below.
    onStopped: () => options.bridge.fail(port),
    ...(options.idleMs !== undefined ? { idleMs: options.idleMs } : {}),
  });
  /** What the bridge holds: stable across worker generations. */
  const port: PageEnginePort = { post: (message) => worker.port().post(message) };

  const run = async (): Promise<void> => {
    const ready = await store.anyReady(REFS).catch(() => false);
    // Disposed while the cache was being read: attach nothing.
    if (disposed) return;
    if (ready && !detach) {
      detach = options.bridge.attach(port, {
        runtimes: RUNTIMES,
        probeTimeoutMs: HOST_BFI_PROBE_TIMEOUT_MS,
        ...(nativePath() ? { preferred: true } : {}),
      });
    } else if (!ready && detach) {
      const d = detach;
      detach = undefined;
      d();
      worker.dispose();
    }
    worker.invalidate();
  };
  let inflight: Promise<void> | undefined;
  let queued: Promise<void> | undefined;

  const support = async (): Promise<LocalDeviceSupport> => {
    const native = nativeModule();
    return native ? native.BfiEngine.support() : bfiSupportWithoutWasm(data.deviceMemoryBytes);
  };

  const runtime: HostBfiRuntime = {
    files: createModelFileServer(store, () => void runtime.refresh(), support),
    store,
    get native() {
      return nativeModule() !== null;
    },
    support,
    refresh() {
      if (!inflight) {
        inflight = run().finally(() => {
          inflight = undefined;
        });
        return inflight;
      }
      queued ??= inflight.then(() => {
        queued = undefined;
        return runtime.refresh();
      });
      return queued;
    },
    dispose() {
      disposed = true;
      runtime.files.dispose();
      const d = detach;
      detach = undefined;
      d?.();
      worker.dispose();
    },
  };

  void runtime.refresh();
  return runtime;
}
