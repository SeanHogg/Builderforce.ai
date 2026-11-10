/**
 * The run-outcome labellers' worker entry (bundled to `out/runOutcomeWorker.js`, `esbuild.mjs`): ONE batch per worker — every
 * pending run of one repository over that repository's shared history — so the masking and blame matching never hold the
 * extension host's thread (`labelBatch.ts` `labelBatchOffThread` starts and terminates it).
 */

import { parentPort } from "node:worker_threads";
import { labelBatch, type LabelBatch } from "./labelBatch";

parentPort?.once("message", (batch: LabelBatch) => {
  try {
    parentPort?.postMessage({ ok: true, labels: labelBatch(batch) });
  } catch (error) {
    parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
