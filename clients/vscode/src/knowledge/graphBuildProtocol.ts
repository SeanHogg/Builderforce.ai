/**
 * What crosses between the extension host and its knowledge GRAPH worker (`graphWorker.ts` ⇄ `graphWorkerEntry.ts`): every
 * graph build in the VSIX, as plain, BOUNDED data. Never `vscode`, never a function (a `FindingsProvider`, a pack) — the worker
 * rebuilds the packs from the layer registry and reads the root's facts from the folder's SQLite file itself.
 *
 *   - `stored`: the knowledge view's graph and a run delta's side (`buildStoredGraph`). The request names the folder and the
 *     root; the worker opens the folder's knowledge file through its OWN read-only connection, so the repository's extracts
 *     never cross. Only the knobs cross (focus, node cap, the side's hash overrides, the index's near-duplicate pairs).
 *   - `pack`: a loaded knowledge pack's graph (a read-only pack root, the pack's index cards); the worker reads the `.bfpack`
 *     file by its path.
 *   - `extracted`: the PreFetch code actions' graph over an analysis the host already holds (`codeGraphFindings`); its
 *     `extracted` goes host → worker as bounded parts, and only the findings and placed layers come back.
 *
 * Results scale with the repository (the outline lists every file, findings span the whole graph), so the large arrays come
 * back as bounded parts (`workers/boundedTransfer.ts`) and a result past the transfer budget is refused by the worker with
 * {@link GRAPH_RESULT_OVER_BUDGET} — the giant message is never built on either side.
 */

import type { CodeGraphFindings } from "@builderforce/agent-tools/knowledge";
import type { Extracted, KnowledgeGraph, PartitionRegistry, SimilarPair } from "@seanhogg/builderforce-memory/knowledge";
import { RESULT_OVER_BUDGET, type TransferPart } from "../workers/boundedTransfer";

/** One root's stored graph (`buildStoredGraph` over the folder's knowledge file). */
export interface StoredGraphRequest {
  kind: "stored";
  /** The workspace folder whose `.builderforce/cache/knowledge/index.sqlite` the worker opens read-only. */
  folderPath: string;
  rootId: string;
  /** The code pack's layer registry (`readPartitions`); absent ⇒ the default layers. */
  partitions?: PartitionRegistry;
  nearDuplicates?: SimilarPair[];
  focus?: string[];
  maxNodes?: number;
  /** A run-delta side: root-relative path → the content hash to read instead (`null`: absent on this side). */
  hashOverrides?: Map<string, string | null>;
  /** The graph is for the knowledge VIEW (host → webview): bounded (`graphBudget.ts`) before it leaves the build. */
  view?: boolean;
}

/** The code actions' graph over an analysis the host holds (`codeGraphFindings`). */
export interface ExtractedGraphRequest {
  kind: "extracted";
  rootId: string;
  partitions: PartitionRegistry;
  /** Crosses host → worker as bounded parts ({@link EXTRACTED_REQUEST_ARRAYS}). */
  extracted: Extracted[];
}

/** A loaded pack's graph (`packGraph`): the worker reads and parses the `.bfpack` file itself, so nothing of the pack crosses. */
export interface PackGraphRequest {
  kind: "pack";
  file: string;
  focus?: string[];
  maxNodes?: number;
  /** The graph is for the knowledge VIEW: bounded before it leaves the build. Absent for the pack's cards and index. */
  view?: boolean;
}

export type GraphBuildRequest = StoredGraphRequest | ExtractedGraphRequest | PackGraphRequest;

/** What each request answers. */
export type GraphBuildResult<R extends GraphBuildRequest> = R extends ExtractedGraphRequest ? CodeGraphFindings : KnowledgeGraph | null;

/** The stable code of a result over the transfer budget (a permanent failure for that build). */
export const GRAPH_RESULT_OVER_BUDGET = `graph_${RESULT_OVER_BUDGET}`;
/** The worker could not open the folder's knowledge file (no `node:sqlite` in this runtime, a locked or newer file). */
export const GRAPH_STORE_UNAVAILABLE = "graph_store_unavailable";

/** The arrays of a request that scale with the repository: they cross as bounded parts. */
export const EXTRACTED_REQUEST_ARRAYS = ["extracted"] as const;
/** The arrays of a stored graph that scale with the repository (the outline lists every file of the whole graph). */
export const GRAPH_RESULT_ARRAYS = ["nodes", "edges", "findings", "outline.files", "outline.links"] as const;
/** The arrays of the code actions' answer. */
export const CODE_GRAPH_RESULT_ARRAYS = ["findings", "placed"] as const;

/** The result arrays of a request's kind. */
export const resultArraysOf = (kind: GraphBuildRequest["kind"]): readonly string[] => (kind === "extracted" ? CODE_GRAPH_RESULT_ARRAYS : GRAPH_RESULT_ARRAYS);

/** Host → worker: a request's parts first, then `build` completes it. One request at a time. */
export type GraphWorkerMessage = TransferPart | { type: "build"; id: number; request: GraphBuildRequest };

/** Worker → host: the result's parts first, then `done` (or `error`), naming the request. */
export type GraphWorkerReply =
  | TransferPart
  | { type: "done"; id: number; result: KnowledgeGraph | CodeGraphFindings | null }
  | { type: "error"; id: number; error: string; code?: string };
