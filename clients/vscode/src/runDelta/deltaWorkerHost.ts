/**
 * Runs the engine OFF the extension host's thread (PRD 41 §C14 budget): one `worker_threads` worker per delta, started from
 * the bundle entry beside `extension.js` (`out/runDeltaWorker.js`, built like the extraction pool's worker), terminated when
 * the caller's signal aborts — so the delta's budget truly preempts a slow rule.
 *
 * No worker file (the test harness, a dev run before the bundle exists): the same `computePrepared` runs in this thread.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import type { RunDelta } from "@builderforce/run-delta";
import { computePrepared, type PreparedDelta } from "./preparedPorts";

/** The bundle entry esbuild writes beside `out/extension.js`. */
export const DELTA_WORKER_FILE = "runDeltaWorker.js";

const workerFile = (): string | undefined => {
  const file = path.join(__dirname, DELTA_WORKER_FILE);
  return fs.existsSync(file) ? file : undefined;
};

/** The delta of `prepared`, in a worker when the bundle has one. Rejects on `signal` (and the worker is terminated). */
export function computeInWorker(prepared: PreparedDelta, signal?: AbortSignal): Promise<RunDelta> {
  const file = workerFile();
  if (!file) return computePrepared(prepared);
  return new Promise<RunDelta>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("run_delta_aborted"));
    const worker = new Worker(file);
    const stop = (): void => { void worker.terminate(); };
    const onAbort = (): void => { stop(); reject(new Error("run_delta_aborted")); };
    signal?.addEventListener("abort", onAbort, { once: true });
    const done = (): void => { signal?.removeEventListener("abort", onAbort); stop(); };
    worker.once("message", (reply: { ok: true; delta: RunDelta } | { ok: false; error: string }) => {
      done();
      if (reply.ok) resolve(reply.delta);
      else reject(new Error(reply.error));
    });
    worker.once("error", (error) => { done(); reject(error); });
    worker.once("exit", (code) => { if (code !== 0) reject(new Error(`run_delta_worker_exit:${code}`)); });
    worker.postMessage(prepared);
  });
}
