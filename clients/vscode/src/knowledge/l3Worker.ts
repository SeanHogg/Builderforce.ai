/**
 * Runs the L3 analysis OFF the extension host's thread: ONE `worker_threads` worker per job, started from the bundle entry
 * beside `extension.js` (`out/knowledgeL3Worker.js`, built like the extraction pool's and the run delta's workers).
 *
 *   - the worker rebuilds its ports from plain data ({@link L3Job}) and posts plain data back ({@link WorkspaceExtracted}),
 *     with the analyzers' progress and warnings on the way, forwarded to the caller's own callbacks on THIS thread;
 *   - the caller's signal terminates the worker at once (a keystroke or a started agent run stops a synchronous build that no
 *     abort flag could reach) and the job resolves to nothing — the same "the asker who stopped gets nothing" answer the
 *     in-thread analysis gives, so a stopped pass never fails a review;
 *   - the worker's heap is bounded ({@link L3_WORKER_HEAP_MB}): an out-of-memory ends the WORKER, which rejects the job with
 *     the reason (logged as a failed L3 pass by the caller), never the extension host;
 *   - no worker file (a test, a dev run before the bundle exists): the same job runs in this thread.
 *
 * ONE seam for every analysis in the VSIX: {@link workspaceRunner} is the review's / the indexer's runner
 * (`rootCodeAnalyzers`) and {@link runL3InWorker} serves the chat prefetch code actions (`prefetch/executors.ts`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Worker, type ResourceLimits } from "node:worker_threads";
import type { WorkspaceExtracted, WorkspaceExtractedHooks, WorkspaceExtractedRunner } from "@builderforce/agent-tools/knowledge";
import { rehydratedResult, runL3Job, type L3Job, type L3WorkerReply } from "./l3WorkerJob";

/** The bundle entry esbuild writes beside `out/extension.js`. */
export const L3_WORKER_FILE = "knowledgeL3Worker.js";
/** The worker's old-generation heap cap: an analysis of a huge repo that outgrows it dies alone. */
export const L3_WORKER_HEAP_MB = 2048;

/** What the host uses of a `worker_threads` Worker (a test hands in its own). */
export interface L3WorkerHandle {
  postMessage(message: unknown): void;
  on(event: "message" | "error" | "exit", listener: (value: any) => void): unknown;
  terminate(): Promise<number> | void;
}

/** Seams, for tests. */
export interface L3WorkerSeams {
  /** The worker's script; `null` ⇒ none (run in this thread). Default: {@link L3_WORKER_FILE} beside the bundle, when it exists. */
  file?: string | null;
  spawn?: (file: string, options: { resourceLimits: ResourceLimits }) => L3WorkerHandle;
  /** The in-thread run; default `runL3Job`. */
  inThread?: (job: L3Job, hooks: WorkspaceExtractedHooks) => Promise<WorkspaceExtracted>;
}

/** What an analysis nobody waits for any more is. */
const NOTHING: WorkspaceExtracted = { extracted: [], snapshot: null };

const workerFile = (): string | null => {
  const file = path.join(__dirname, L3_WORKER_FILE);
  return fs.existsSync(file) ? file : null;
};

/** The analysis of `job` in a worker when the bundle has one (else in this thread). Rejects when the worker fails; resolves to nothing when `hooks.signal` stops it. */
export function runL3InWorker(job: L3Job, hooks: WorkspaceExtractedHooks = {}, seams: L3WorkerSeams = {}): Promise<WorkspaceExtracted> {
  const file = seams.file === undefined ? workerFile() : seams.file;
  if (!file) return (seams.inThread ?? runL3Job)(job, hooks);
  const { signal } = hooks;
  return new Promise<WorkspaceExtracted>((resolve, reject) => {
    if (signal?.aborted) return resolve(NOTHING);
    const options = { resourceLimits: { maxOldGenerationSizeMb: L3_WORKER_HEAP_MB } };
    const worker = (seams.spawn ?? ((f, o) => new Worker(f, o)))(file, options);
    let settled = false;
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      finish();
    };
    const onAbort = (): void => settle(() => resolve(NOTHING));
    signal?.addEventListener("abort", onAbort, { once: true });
    worker.on("message", (reply: L3WorkerReply) => {
      if (reply.type === "progress") hooks.onProgress?.(reply.progress);
      else if (reply.type === "warn") hooks.onWarn?.(reply.message);
      else if (reply.type === "done") settle(() => resolve(rehydratedResult(reply.result)));
      else settle(() => reject(new Error(reply.error)));
    });
    // An out-of-memory arrives as an `error` (ERR_WORKER_OUT_OF_MEMORY) and then an `exit`; either ends the job, once.
    worker.on("error", (error: unknown) => settle(() => reject(error instanceof Error ? error : new Error(String(error)))));
    worker.on("exit", (code: number) => settle(() => reject(new Error(`l3_worker_exit:${code}`))));
    worker.postMessage(job);
  });
}

/**
 * The runner of one root's analysis (`workspaceCodeAnalyzers({ runner })`): the job's constants are the root's, the rest comes
 * with each call. `onResult` sees every finished result on THIS thread (the review recorder's edge count).
 */
export function workspaceRunner(
  job: Omit<L3Job, "rootId">, onResult?: (result: WorkspaceExtracted) => void,
  run: (job: L3Job, hooks: WorkspaceExtractedHooks) => Promise<WorkspaceExtracted> = runL3InWorker,
): WorkspaceExtractedRunner {
  return async (rootId, hooks) => {
    const result = await run({ ...job, rootId }, hooks);
    if (!hooks.signal?.aborted) onResult?.(result);
    return result;
  };
}
