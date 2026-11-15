/**
 * Runs every knowledge GRAPH build OFF the extension host's thread: ONE reused `worker_threads`
 * worker (`graphWorkerEntry.ts` → `out/knowledgeGraphWorker.js`), started beside the bundle and kept
 * for the process — contrast the L3 analysis (`l3Worker.ts`), ONE worker per job. The worker reads
 * the folder's knowledge file through its own read-only connection, so a synchronous build of a huge
 * repo never holds the extension host's thread and the repository's extracts never cross it.
 *
 *   - the host posts a plain {@link GraphBuildRequest} (`graphBuildProtocol.ts`); the worker posts
 *     the result back as bounded parts then a `done` head, reassembled here ({@link PartsReceiver});
 *   - ONE build at a time, in arrival order: a build waits behind the one in flight (a view load and
 *     a run-delta side never build at once), each named by an id the replies echo;
 *   - an `extracted` request's large array crosses host → worker as bounded parts, then its `build`;
 *   - the caller's `AbortSignal` drops a queued build or terminates the worker under a running one —
 *     the build rejects with {@link GRAPH_BUILD_ABORTED}, so a superseded load never fails the view;
 *   - a worker crash (out-of-memory, an exit) rejects the build in flight and the NEXT build spawns
 *     a fresh worker — the host carries on;
 *   - no worker file (a test, a dev run before the bundle exists): the SAME build runs in this
 *     thread, through the host's own open store ({@link runGraphBuild} over {@link folderKnowledge}).
 *
 * Never imports `vscode`: the worker bundle must not reach it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";
import type { CodeGraphFindings } from "@builderforce/agent-tools/knowledge";
import type { KnowledgeGraph } from "@seanhogg/builderforce-memory/knowledge";
import { PartsReceiver, postBounded } from "../workers/boundedTransfer";
import { folderKnowledge } from "./folderKnowledge";
import {
  EXTRACTED_REQUEST_ARRAYS, GRAPH_RESULT_ARRAYS, CODE_GRAPH_RESULT_ARRAYS, type GraphBuildRequest, type GraphWorkerMessage, type GraphWorkerReply, type StoredGraphRequest,
} from "./graphBuildProtocol";
import { runGraphBuild, type FolderStores } from "./graphBuildJob";

/** The bundle entry esbuild writes beside `out/extension.js`. */
export const GRAPH_WORKER_FILE = "knowledgeGraphWorker.js";
/** A build the asker stopped answers this; a superseded load is dropped, never a failure. */
export const GRAPH_BUILD_ABORTED = "graph_build_aborted";

/** What the host uses of a `worker_threads` Worker (a test hands in its own). */
export interface GraphWorkerHandle {
  postMessage(message: unknown): void;
  on(event: "message" | "error" | "exit", listener: (value: any) => void): unknown;
  terminate(): Promise<number> | void;
}

/** Seams, for tests. */
export interface GraphWorkerSeams {
  /** The worker's script; `null` ⇒ none (run in this thread). Default: {@link GRAPH_WORKER_FILE} beside the bundle, when it exists. */
  file?: string | null;
  spawn?: (file: string) => GraphWorkerHandle;
}

const aborted = (): Error => Object.assign(new Error(GRAPH_BUILD_ABORTED), { code: GRAPH_BUILD_ABORTED });

/** The in-thread folder record for the fallback: the host's own open store and manifest. */
const hostFolderStores: FolderStores = (folderPath) => {
  const opened = folderKnowledge(folderPath);
  return { store: opened.store, manifest: opened.manifest };
};

const workerFile = (): string | null => {
  const file = path.join(__dirname, GRAPH_WORKER_FILE);
  return fs.existsSync(file) ? file : null;
};

/** The module-level seams a test overrides; the returned function restores them. */
let seams: GraphWorkerSeams = {};
export function useGraphWorkerSeams(overrides: GraphWorkerSeams): () => void {
  const prior = seams;
  seams = overrides;
  // A new seam set starts from no worker: the next build spawns by the new rules.
  worker.holder = undefined;
  return () => { seams = prior; worker.holder = undefined; };
}

/** The ONE reused worker, spawned lazily and respawned after a crash. */
const worker: { holder: GraphWorkerHandle | undefined } = { holder: undefined };

const spawn = (): GraphWorkerHandle => {
  const file = seams.file === undefined ? workerFile() : seams.file;
  if (!file) throw new Error("graph_worker_unavailable");
  return (seams.spawn ?? ((f: string) => new Worker(f) as unknown as GraphWorkerHandle))(file);
};

interface QueueEntry {
  id: number;
  request: GraphBuildRequest;
  signal?: AbortSignal;
  parts: PartsReceiver;
  resolve(result: KnowledgeGraph | CodeGraphFindings | null): void;
  reject(error: unknown): void;
  settle(finish: () => void): void;
  onAbort(): void;
}

/** Builds waiting for the worker, in arrival order; only the head runs. */
const queue: QueueEntry[] = [];
let nextId = 1;
let draining = false;

const resultArraysOf = (request: GraphBuildRequest): readonly string[] => (request.kind === "extracted" ? CODE_GRAPH_RESULT_ARRAYS : GRAPH_RESULT_ARRAYS);

/** Rebuilds a result from the `done` head and the parts that came before it. */
function assembleResult(request: GraphBuildRequest, head: KnowledgeGraph | CodeGraphFindings | null, parts: PartsReceiver): KnowledgeGraph | CodeGraphFindings | null {
  if (head === null) return null;
  const arrays = resultArraysOf(request);
  let value: unknown = head;
  // assembleBounded walks dot-paths; the graph arrays are top-level, so fold them by key.
  for (const key of arrays) {
    const arrived = parts.take(key);
    if (arrived.length === 0) continue;
    value = { ...(value as Record<string, unknown>), [key]: [...((value as Record<string, unknown[]>)[key] ?? []), ...arrived] };
  }
  return value as KnowledgeGraph | CodeGraphFindings;
}

/** Sends a request: an `extracted` array goes as bounded parts first, then `build` completes it. */
function sendRequest(entry: QueueEntry): void {
  const w = worker.holder!;
  const send: (message: GraphWorkerMessage) => void = (m) => w.postMessage(m);
  if (entry.request.kind === "extracted") {
    const head = postBounded(send, entry.request, [...EXTRACTED_REQUEST_ARRAYS]);
    send({ type: "build", id: entry.id, request: head });
  } else {
    send({ type: "build", id: entry.id, request: entry.request });
  }
}

/** Drops the entry (aborted) and keeps the queue draining. */
function dropEntry(entry: QueueEntry, error: unknown): void {
  entry.settle(() => entry.reject(error));
  drain();
}

/** Runs the queued builds one at a time on the (single reused) worker. */
function drain(): void {
  if (draining) return;
  const entry = queue[0];
  if (!entry) return;
  if (entry.signal?.aborted) { queue.shift(); dropEntry(entry, aborted()); return; }
  if (!worker.holder) {
    try { worker.holder = spawn(); } catch (error) {
      // No worker (and no in-thread fallback wanted here): the build fails.
      queue.shift();
      dropEntry(entry, error);
      return;
    }
    const w = worker.holder;
    w.on("message", (message: GraphWorkerReply) => {
      const head = queue[0];
      if (!head || w !== worker.holder) return;
      if (head.parts.accept(message)) return; // a slice of the result: kept until `done` completes it
      if (message.type === "done" && message.id === head.id) {
        queue.shift();
        head.settle(() => head.resolve(assembleResult(head.request, message.result, head.parts)));
        drain();
      } else if (message.type === "error" && message.id === head.id) {
        queue.shift();
        head.settle(() => head.reject(Object.assign(new Error(message.error), message.code ? { code: message.code } : {})));
        drain();
      }
    });
    w.on("error", (error: unknown) => {
      const head = queue[0];
      worker.holder = undefined; // a crashed worker is not reused; the next build respawns
      if (head && w === headSignalWorker(head)) { queue.shift(); head.settle(() => head.reject(error instanceof Error ? error : new Error(String(error)))); }
      drain();
    });
    w.on("exit", (code: number) => {
      const head = queue[0];
      worker.holder = undefined;
      if (head && w === workerFor(head)) { queue.shift(); head.settle(() => head.reject(new Error(`graph_worker_exit:${code}`))); }
      drain();
    });
  }
  draining = true;
  sendRequest(entry);
  draining = false;
}

// The worker an entry ran on, for matching a crash to the build in flight.
const workerFor = (entry: QueueEntry): GraphWorkerHandle | undefined => worker.holder;
const headSignalWorker = (_entry: QueueEntry): GraphWorkerHandle | undefined => worker.holder;

/**
 * ONE graph build, in the reused worker when the bundle has one (else in this thread). An aborted
 * signal rejects with {@link GRAPH_BUILD_ABORTED}; a worker crash rejects the build in flight and
 * respawns for the next. The in-thread fallback runs the SAME build through the host's open store.
 */
export async function buildOffThread<R extends GraphBuildRequest>(
  request: R,
  signal?: AbortSignal,
): Promise<(R extends { kind: "extracted" } ? CodeGraphFindings : KnowledgeGraph | null)> {
  const file = seams.file === undefined ? workerFile() : seams.file;
  if (!file) {
    // No worker (a test, a dev run before the bundle exists): the same build, in this thread.
    if (signal?.aborted) throw aborted();
    return (await runGraphBuild(request, hostFolderStores)) as never;
  }

  return new Promise<KnowledgeGraph | CodeGraphFindings | null>((resolve, reject) => {
    let settled = false;
    const entry: QueueEntry = {
      id: nextId++, request, signal, parts: new PartsReceiver(),
      resolve: (r) => { resolve(r); }, reject: (e) => { reject(e); },
      settle(finish) { if (settled) return; settled = true; signal?.removeEventListener("abort", this.onAbort); finish(); },
      onAbort() {
        const at = queue.indexOf(entry);
        if (at > 0) { queue.splice(at, 1); dropEntry(entry, aborted()); return; } // queued: dropped
        // In flight: the worker is terminated (a synchronous build no flag could reach); the next build respawns.
        worker.holder = undefined;
        dropEntry(entry, aborted());
      },
    };
    signal?.addEventListener("abort", entry.onAbort, { once: true });
    queue.push(entry);
    drain();
  }) as never;
}

/** The stored graph, off the thread: the knowledge view's `loadGraph`, a run delta's side, a pack's cards. */
export function storedGraphOffThread(
  args: {
    folderPath: string; rootId: string;
    partitions?: import("@seanhogg/builderforce-memory/knowledge").PartitionRegistry;
    nearDuplicates?: import("@seanhogg/builderforce-memory/knowledge").SimilarPair[];
    focus?: string[]; maxNodes?: number;
    hashOverrides?: ReadonlyMap<string, string | null>;
  },
  _store?: unknown,
  signal?: AbortSignal,
): Promise<KnowledgeGraph | null> {
  const { folderPath, rootId, partitions, nearDuplicates, focus, maxNodes, hashOverrides } = args;
  const request: StoredGraphRequest = {
    kind: "stored", folderPath, rootId,
    ...(partitions ? { partitions } : {}),
    ...(nearDuplicates ? { nearDuplicates } : {}),
    ...(focus ? { focus } : {}),
    ...(maxNodes ? { maxNodes } : {}),
    ...(hashOverrides ? { hashOverrides: new Map(hashOverrides) } : {}),
  };
  return buildOffThread(request, signal) as Promise<KnowledgeGraph | null>;
}
