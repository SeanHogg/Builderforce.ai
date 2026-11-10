/**
 * The run delta's worker entry (bundled to `out/runDeltaWorker.js`, `esbuild.mjs`): ONE engine call per worker, over the
 * prepared data the extension host gathered (`runDeltaPorts.ts`). The host terminates the worker when the delta's budget runs
 * out, so a slow rule never holds the extension host's thread.
 */

import { parentPort } from "node:worker_threads";
import { computePrepared, type PreparedDelta } from "./preparedPorts";

parentPort?.once("message", (prepared: PreparedDelta) => {
  computePrepared(prepared).then(
    (delta) => parentPort?.postMessage({ ok: true, delta }),
    (error: unknown) => parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
});
