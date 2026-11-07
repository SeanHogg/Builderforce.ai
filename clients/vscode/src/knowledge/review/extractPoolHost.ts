/**
 * The extension's ONE extraction pool (PRD 41 A8): created on the first review, kept for the life
 * of the extension and disposed at deactivate. A review asks {@link reviewParallelism} what to pass
 * the runner. No pool (one core, `worker_threads` or the worker file missing) means the review
 * extracts in-thread exactly as before, at memory's default width. A worker that never loads takes the
 * pool DOWN for the session: its jobs run in this thread through the same extraction code, and the
 * reason is kept for the run record (`extractPoolDown`).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { CodeSymbol } from "@builderforce/agent-tools";
import type { KnowledgeReviewOptions, SymbolLookup } from "@builderforce/agent-tools/knowledge";
import type { ExtractPool } from "@seanhogg/builderforce-memory/knowledge";
import { handleExtractJob, type HostExtractJob } from "./extractJobHandler";
import { createExtractPool, defaultExtractPoolSize, type ExtractPoolHandle } from "./extractPool";

/** The bundle entry esbuild writes beside `out/extension.js`. */
export const EXTRACT_WORKER_FILE = "knowledgeExtractWorker.js";

/** Files judged at once. Memory's shared limiter (its `maxModelCalls`, halved on a rate limit) bounds the model calls in flight, so this is not also capped here. */
export const JUDGE_CONCURRENCY = 4;

let outDir: string | undefined;
let handle: ExtractPoolHandle | undefined;
let unavailable = false;
let sizeOf: () => number = () => defaultExtractPoolSize();
let downReason: string | undefined;

/** Called once at activation with the extension's install folder. */
export function configureExtractPool(extensionPath: string, size: () => number = () => defaultExtractPoolSize()): void {
  outDir = extensionPath ? path.join(extensionPath, "out") : undefined;
  unavailable = false;
  sizeOf = size;
  downReason = undefined;
}

function poolHandle(): ExtractPoolHandle | undefined {
  if (handle || unavailable || !outDir) return handle;
  const workerFile = path.join(outDir, EXTRACT_WORKER_FILE);
  const size = sizeOf();
  // One core to spare or fewer: a pool of one only adds a thread hop. The review keeps its default width.
  if (size <= 1 || !fs.existsSync(workerFile)) {
    unavailable = true;
    return undefined;
  }
  handle = createExtractPool({
    size, workerFile, fallback: (job) => handleExtractJob(job as HostExtractJob), onDown: (reason) => { downReason = reason; },
  });
  return handle;
}

/** Why parallel extraction is unavailable in this session (a worker that never loaded); undefined while it works or is not used. */
export const extractPoolDown = (): string | undefined => downReason;

/** The pool as a review's `extractPool`: each job carries the index's definitions of its file (a hit), as plain data. */
export function withIndexSymbols(pool: ExtractPool, lookup: SymbolLookup | undefined, rootPath?: string): ExtractPool {
  if (!lookup && !rootPath) return pool;
  return (job, signal) => {
    const symbols: readonly CodeSymbol[] | undefined = job.sectionsOnly || !lookup ? undefined : lookup(job.path);
    // A job the review left unread (`readByPool`, PRD 41 A10 rule 8) tells the worker where to read its own file.
    const readFrom = job.readByPool && rootPath ? { rootPath, path: job.path, hash: job.hash } : undefined;
    return pool(symbols || readFrom ? ({ ...job, ...(symbols ? { symbols } : {}), ...(readFrom ? { readFrom } : {}) } as HostExtractJob) : job, signal);
  };
}

/** The parallelism a review runs with: the pool and its width when there is one, always the judge width. */
export function reviewParallelism(lookup?: SymbolLookup, rootPath?: string): Pick<KnowledgeReviewOptions, "extractPool" | "concurrency" | "judgeConcurrency" | "deferRead"> {
  const pool = poolHandle();
  return { judgeConcurrency: JUDGE_CONCURRENCY, ...(pool ? { extractPool: withIndexSymbols(pool.pool, lookup, rootPath), concurrency: pool.size, ...(rootPath ? { deferRead: true } : {}) } : {}) };
}

/** Creates the pool and starts its workers now, so the first file of a confirmed review meets a loaded worker (PRD 41 A10 rule 8). No pool ⇒ nothing. */
export function prewarmExtractPool(): void {
  poolHandle()?.warm();
}

export function disposeExtractPool(): void {
  handle?.dispose();
  handle = undefined;
}
