/**
 * The review's extraction worker (a `worker_threads` entry, `out/knowledgeExtractWorker.js`): announces `{ ready: true }` once its module has loaded (a death before that is a failed start, after it a
 * crash on a file), then answers
 * the pool's `{ id, job }` messages with `{ id, result }` or `{ id, error }`. The work is
 * `extractJobHandler.ts` (the same function the host runs in-thread when the pool is down); this file
 * only wires the port. Never imports `vscode`.
 */

import { parentPort } from "node:worker_threads";
import { ExtractFailed, reasonOf } from "@seanhogg/builderforce-memory/knowledge";
import { handleExtractJob, type HostExtractJob } from "./extractJobHandler";

const port = parentPort;
if (!port) throw new Error("knowledgeExtractWorker must run in a worker thread");

port.on("message", (message: { id: number; job: HostExtractJob }) => {
  handleExtractJob(message.job).then(
    (result) => port.postMessage({ id: message.id, result }),
    // `final` only for a parser or extractor error: every other rejection (a read, a lock, a timeout) is transient to the review.
    (error: unknown) => port.postMessage({ id: message.id, error: reasonOf(error), ...(error instanceof ExtractFailed || (error as { name?: unknown } | null)?.name === "ExtractFailed" ? { final: true } : {}) }),
  );
});

// Everything above loaded: the pool tells a failed start from a crash on a file by this message.
port.postMessage({ ready: true });
