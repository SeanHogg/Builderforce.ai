/**
 * The extension host's `bfi` worker (a `worker_threads` entry, `out/bfiHostWorker.js`):
 * the SAME vendored `bfi-web` wasm the chat webview runs, on its CPU backend (Node has
 * no WebGPU), behind the SAME `bfi` page-engine adapter over the host's file cache —
 * served with brain-embedded's ONE engine-worker half (`serveEngineWorker`): the
 * page-engine frames, the INVALIDATE frame, and a FATAL frame when the wasm traps —
 * reported by the engine or surfacing as an unhandled rejection (the host then starts a
 * fresh worker).
 *
 * Single-threaded: the threaded artifact's pool spawns Web Workers (wasm-bindgen-rayon),
 * and Node's `worker_threads` provides no `Worker` global to spawn them with.
 *
 * A worker, not the extension host's thread: decoding on the CPU blocks for each token,
 * and the extension host must keep answering the editor.
 */
import { readFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { createBfiEngine, forgetBfiWeb, loadBfiWeb, serveEngineWorker } from "@seanhogg/builderforce-brain-embedded/bfi";
import { createFileModelStore } from "./modelFiles";
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

const engine = createBfiEngine({
  loadBfi: () => loadBfiWeb(readFileSync(data.wasmPath)),
  store: createFileModelStore(data.modelDir),
  deviceMemoryBytes: data.deviceMemoryBytes,
  // The host worker is the editor's CPU engine (the webview's worker serves WebGPU only).
  backends: ["cpu"],
  onTrap: (error) => served.fatal(error),
});
