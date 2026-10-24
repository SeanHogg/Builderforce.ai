/**
 * The extension host's `bfi` worker (a `worker_threads` entry, `out/bfiHostWorker.js`):
 * Synapse's engine behind the SAME `bfi` page-engine adapter a page runs, over the host's
 * file cache — served with brain-embedded's ONE engine-worker half (`serveEngineWorker`):
 * the page-engine frames, the INVALIDATE frame, and a FATAL frame when the engine traps —
 * reported by the engine or surfacing as an unhandled rejection (the host then starts a
 * fresh worker).
 *
 * The engine is the NATIVE addon when this build ships one for this platform and it
 * loads (`nativeEngine.ts`): native wgpu for the GPU, every core for the CPU, so it
 * serves both backends. Otherwise the vendored `bfi-web` wasm, CPU only and
 * single-threaded (Node has no WebGPU, and `worker_threads` provides no `Worker` global
 * for wasm-bindgen-rayon's pool).
 *
 * A worker, not the extension host's thread: decoding blocks for each token, and the
 * extension host must keep answering the editor.
 */
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { createBfiEngine, forgetBfiWeb, loadBfiWeb, serveEngineWorker } from "@seanhogg/builderforce-brain-embedded/bfi";
import { createFileModelStore } from "./modelFiles";
import { loadNativeBfi } from "./nativeEngine";
import type { HostBfiWorkerData } from "./protocol";

const port = parentPort;
if (!port) throw new Error("bfiHostWorker must run in a worker thread");
const data = workerData as HostBfiWorkerData;

const served = serveEngineWorker(
  {
    post: (message) => port.postMessage(message),
    listen: (onMessage) => {
      port.on("message", onMessage);
      return () => port.off("message", onMessage);
    },
    onUncaught: (listener) => void process.on("unhandledRejection", (reason) => void listener(reason)),
  },
  // Read on the first request, after the engine below exists.
  () => [engine],
  undefined,
  { onFatal: forgetBfiWeb },
);

const native = loadNativeBfi(data.nativePath, (error) =>
  console.error("[bfi] the native engine did not load here; the wasm serves instead:", error),
);

const engine = createBfiEngine({
  loadBfi: async () => native ?? loadBfiWeb(readFileSync(data.wasmPath)),
  store: createFileModelStore(data.modelDir),
  deviceMemoryBytes: data.deviceMemoryBytes,
  // Native: the GPU (wgpu) and the CPU. Wasm: the CPU only — the webview's worker is the
  // one that serves WebGPU then.
  backends: native ? ["webgpu", "cpu"] : ["cpu"],
  ...(native ? { supportFromEngine: true } : {}),
  onTrap: (error) => served.fatal(error),
});
