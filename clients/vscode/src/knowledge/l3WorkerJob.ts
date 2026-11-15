/**
 * One L3 analysis job as PLAIN DATA, and the function that runs it — the body of the L3 worker (`l3WorkerEntry.ts`) and the
 * in-thread fallback of the worker host (`l3Worker.ts`, no worker file in a test or a dev run): the ports are rebuilt from data
 * (the folder, the layers, whether the L3 result cache is bound) and handed to the shared `analyseWorkspaceExtracted`.
 *
 * Runs inside a `worker_threads` worker, so nothing here (nor anything it imports) may reach `vscode`: the local capability
 * provider, the L3 cache binding and the repo map are all node-only.
 */

import { analyseWorkspaceExtracted, graphAcceptsOf, type WorkspaceExtracted, type WorkspaceExtractedHooks } from "@builderforce/agent-tools/knowledge";
import type { PartitionRegistry } from "@seanhogg/builderforce-memory/knowledge";
import { repoMapPort } from "@builderforce/repo-map";
import { buildLocalCapabilityProvider } from "../localCapabilities";
import { indexerL3Binding } from "../runDelta/analyzers/l3Binding";
import {
  assembleBounded, isOverBudget, postBounded, RESULT_OVER_BUDGET, type PartsReceiver, type TransferLimits, type TransferPart,
} from "../workers/boundedTransfer";

/** What the worker needs of the extension host's world, as structured-cloneable data. */
export interface L3Job {
  /** The workspace folder the analyzers run in (`root.folderPath`). */
  folderPath: string;
  /** The knowledge root id: part of the analysis' identity. */
  rootId: string;
  /** Set ⇒ THE L3 result cache (shared with the run delta) is bound for this root path; absent for a sub-folder root and for the code actions. */
  l3RootPath?: string;
  /** Root-relative sub-folder analysed (a reviewed sub-folder); absent ⇒ the whole tree. */
  path?: string;
  /** The workspace's layer registry; absent ⇒ the analyzers' defaults. */
  partitions?: PartitionRegistry;
}

/** The analysis of `job`, in THIS thread: the ONE implementation the worker and the fallback share. */
export function runL3Job(job: L3Job, hooks: WorkspaceExtractedHooks = {}): Promise<WorkspaceExtracted> {
  return analyseWorkspaceExtracted({
    caps: buildLocalCapabilityProvider(job.folderPath),
    rootId: job.rootId,
    repoGraph: repoMapPort,
    ...(job.l3RootPath ? { l3: indexerL3Binding(job.l3RootPath) } : {}),
    ...(job.path ? { path: job.path } : {}),
    ...(job.partitions ? { partitions: job.partitions } : {}),
    ...(hooks.onWarn ? { onWarn: hooks.onWarn } : {}),
    ...(hooks.onProgress ? { onProgress: hooks.onProgress } : {}),
  }, hooks.signal);
}

/** The result as plain data for `postMessage`: the graph reads' `accepts` is a function (the repo map's policy), which a worker cannot send. */
export function portableResult(result: WorkspaceExtracted): WorkspaceExtracted {
  if (!result.graphReads?.accepts) return result;
  const { accepts: _policy, ...reads } = result.graphReads;
  return { ...result, graphReads: reads };
}

/** The inverse, on the receiving thread: the repo map's policy is put back on the reads the worker sent. */
export function rehydratedResult(result: WorkspaceExtracted): WorkspaceExtracted {
  return result.graphReads ? { ...result, graphReads: { ...result.graphReads, accepts: graphAcceptsOf(repoMapPort) } } : result;
}

/** The stable code of an L3 result over the transfer budget (`workers/boundedTransfer.ts`): a permanent failure for that tree. */
export const L3_RESULT_OVER_BUDGET = `l3_${RESULT_OVER_BUDGET}`;

/** The arrays of a result that scale with the repository: they cross as bounded parts (`workers/boundedTransfer.ts`). */
export const L3_RESULT_ARRAYS = [
  "extracted", "snapshot.nodes", "snapshot.edges", "snapshot.issues", "graphReads.read", "graphReads.skipped.*.paths",
] as const;

/** The result the host reassembles from the `done` message's head and the parts that came before it. */
export function assembledResult(head: WorkspaceExtracted, parts: PartsReceiver): WorkspaceExtracted {
  return assembleBounded(head, parts, L3_RESULT_ARRAYS);
}

/**
 * Sends a finished result from the worker: its large arrays as bounded parts, then `done` with the rest. A result over the
 * transfer budget (or with one item over a part) sends `error` ({@link L3_RESULT_OVER_BUDGET}) instead — the giant message is
 * never built.
 */
export function postResult(send: (reply: L3WorkerReply) => void, result: WorkspaceExtracted, limits?: TransferLimits): void {
  let head: WorkspaceExtracted;
  try {
    head = postBounded(send, portableResult(result), L3_RESULT_ARRAYS, limits);
  } catch (error) {
    if (!isOverBudget(error)) throw error;
    send({ type: "error", error: `${L3_RESULT_OVER_BUDGET}: ${error.message.replace(`${RESULT_OVER_BUDGET}: `, "")}`, code: L3_RESULT_OVER_BUDGET });
    return;
  }
  send({ type: "done", result: head });
}

/** The worker's messages to the host: progress, warnings, the result's parts, then `done` (or `error`). */
export type L3WorkerReply =
  | { type: "progress"; progress: Parameters<NonNullable<WorkspaceExtractedHooks["onProgress"]>>[0] }
  | { type: "warn"; message: string }
  | TransferPart
  | { type: "done"; result: WorkspaceExtracted }
  | { type: "error"; error: string; code?: string };
