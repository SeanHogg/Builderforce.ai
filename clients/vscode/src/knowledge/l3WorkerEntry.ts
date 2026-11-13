/**
 * The L3 analysis worker (a `worker_threads` entry, bundled to `out/knowledgeL3Worker.js`, `esbuild.mjs`): ONE job per worker —
 * the analyzers, the repo graph's build and the conversion to `Extracted` (`l3WorkerJob.ts`) — so the seconds of synchronous
 * work never hold the extension host's thread. The host (`l3Worker.ts`) terminates it when the pass is stopped and bounds its
 * heap (`resourceLimits`), so a runaway analysis ends the worker, never the host. Never imports `vscode`.
 */

import * as path from "node:path";
import { parentPort } from "node:worker_threads";
import { registerBundledAnalyzers } from "../bundledAnalyzers";
import { portableResult, runL3Job, type L3Job, type L3WorkerReply } from "./l3WorkerJob";

const port = parentPort;
if (!port) throw new Error("knowledgeL3Worker must run in a worker thread");

const send = (reply: L3WorkerReply): void => port.postMessage(reply);

port.once("message", (job: L3Job) => {
  // The analyzers ship in `out/analyzers`, beside this bundle: a worker has its own module state, so it registers them itself.
  registerBundledAnalyzers(path.resolve(__dirname, ".."));
  runL3Job(job, {
    onProgress: (progress) => send({ type: "progress", progress }),
    onWarn: (message) => send({ type: "warn", message }),
  }).then(
    (result) => send({ type: "done", result: portableResult(result) }),
    (error: unknown) => send({ type: "error", error: error instanceof Error ? error.message : String(error) }),
  );
});
