/**
 * The L3 analysis worker (a `worker_threads` entry, bundled to `out/knowledgeL3Worker.js`, `esbuild.mjs`): ONE job per worker —
 * the analyzers, the repo graph's build and the conversion to `Extracted` (`l3WorkerJob.ts`) — so the seconds of synchronous
 * work never hold the extension host's thread. Never imports `vscode`.
 *
 * What it can and cannot contain: the host bounds the worker's V8 heap (`resourceLimits`) and terminates it when the pass is
 * stopped, so a runaway analysis HEAP ends the worker alone. But a `postMessage` clone is built in a serializer buffer outside
 * that heap, and in Electron an off-heap allocation that fails ends the WHOLE extension host. So the result never crosses as one
 * message: `postResult` sends its large arrays in bounded parts (`workers/boundedTransfer.ts`) and refuses, with
 * `l3_result_over_budget`, a result past the transfer budget.
 */

import * as path from "node:path";
import { parentPort } from "node:worker_threads";
import { registerBundledAnalyzers } from "../bundledAnalyzers";
import { postResult, runL3Job, type L3Job, type L3WorkerReply } from "./l3WorkerJob";

const port = parentPort;
if (!port) throw new Error("knowledgeL3Worker must run in a worker thread");

const send = (reply: L3WorkerReply): void => port.postMessage(reply);
const fail = (error: unknown): void => send({ type: "error", error: error instanceof Error ? error.message : String(error) });

port.once("message", (job: L3Job) => {
  // The analyzers ship in `out/analyzers`, beside this bundle: a worker has its own module state, so it registers them itself.
  registerBundledAnalyzers(path.resolve(__dirname, ".."));
  runL3Job(job, {
    onProgress: (progress) => send({ type: "progress", progress }),
    onWarn: (message) => send({ type: "warn", message }),
  }).then((result) => {
    try { postResult(send, result); } catch (error) { fail(error); }
  }, fail);
});
