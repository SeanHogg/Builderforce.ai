/**
 * The knowledge GRAPH worker (a `worker_threads` entry, bundled to `out/knowledgeGraphWorker.js`, `esbuild.mjs`): every graph
 * build of the VSIX runs here — the canonical digest and its SHA-256, the layer placement, PageRank, communities and findings
 * are seconds of synchronous work that once held the extension host's thread (`UNRESPONSIVE extension host` profiles). ONE
 * long-lived worker, one request at a time (`graphWorker.ts` queues them). Never imports `vscode`.
 *
 *   - a `stored` build reads the folder's knowledge file through the worker's OWN read-only connection
 *     (`nodeKnowledgeReader`), opened once per folder and kept: its store reloads when the writer's generation moves;
 *   - an `extracted` request's array arrives in bounded parts before its `build` message;
 *   - the result goes back in bounded parts (`workers/boundedTransfer.ts`); one past the budget is refused with
 *     `graph_result_over_budget` — a `postMessage` clone's serializer buffer lives outside the heap limit, and in Electron its
 *     failed growth ends the whole extension host.
 */

import { parentPort } from "node:worker_threads";
import { nodeKnowledgeReader, type NodeKnowledgeReader } from "@builderforce/agent-tools/node-knowledge-store";
import { assembleBounded, isOverBudget, PartsReceiver, postBounded, RESULT_OVER_BUDGET } from "../workers/boundedTransfer";
import { runGraphBuild, type FolderStores } from "./graphBuildJob";
import {
  EXTRACTED_REQUEST_ARRAYS, GRAPH_RESULT_OVER_BUDGET, GRAPH_STORE_UNAVAILABLE, resultArraysOf,
  type GraphBuildRequest, type GraphWorkerMessage, type GraphWorkerReply,
} from "./graphBuildProtocol";

const port = parentPort;
if (!port) throw new Error("knowledgeGraphWorker must run in a worker thread");

const send = (reply: GraphWorkerReply): void => port.postMessage(reply);

/** The folder readers this worker opened (kept for its life; the process exit closes them). */
const readers = new Map<string, NodeKnowledgeReader>();

const stores: FolderStores = (folderPath) => {
  const held = readers.get(folderPath);
  if (held) return held;
  let opened: NodeKnowledgeReader | undefined;
  try {
    opened = nodeKnowledgeReader(folderPath);
  } catch (error) {
    throw Object.assign(new Error(`${GRAPH_STORE_UNAVAILABLE}: ${error instanceof Error ? error.message : String(error)}`), { code: GRAPH_STORE_UNAVAILABLE });
  }
  // No file yet is not kept: the folder's first review creates it.
  if (opened) readers.set(folderPath, opened);
  return opened;
};

const parts = new PartsReceiver();

async function build(id: number, head: GraphBuildRequest): Promise<void> {
  const request = head.kind === "extracted" ? assembleBounded(head, parts, EXTRACTED_REQUEST_ARRAYS) : head;
  parts.clear();
  try {
    const result = await runGraphBuild(request, stores);
    if (result === null) return send({ type: "done", id, result: null });
    try {
      send({ type: "done", id, result: postBounded(send, result, resultArraysOf(request.kind)) });
    } catch (error) {
      if (!isOverBudget(error)) throw error;
      send({ type: "error", id, error: `${GRAPH_RESULT_OVER_BUDGET}: ${error.message.replace(`${RESULT_OVER_BUDGET}: `, "")}`, code: GRAPH_RESULT_OVER_BUDGET });
    }
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    send({ type: "error", id, error: error instanceof Error ? error.message : String(error), ...(typeof code === "string" ? { code } : {}) });
  }
}

// One build at a time, in arrival order (the host sends the next only after this one answered; the chain keeps it so anyway).
let chain: Promise<void> = Promise.resolve();
port.on("message", (message: GraphWorkerMessage) => {
  if (parts.accept(message)) return;
  if (message.type === "build") chain = chain.then(() => build(message.id, message.request));
});
