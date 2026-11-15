/**
 * Runs every knowledge GRAPH build OFF the extension host's thread: ONE reused `worker_threads`
 * worker (`graphWorkerEntry.ts` → `out/knowledgeGraphWorker.js`), started beside the bundle and kept
 * for the process — contrast the L3 analysis (`l3Worker.ts`), ONE worker per job. The worker reads
 * the folder's knowledge file through its own read-only connection, so a synchronous build of a huge
 * repo never holds the extension host's thread and the repository's extracts never cross it.
 *
 *   - the host posts a plain {@link GraphBuildRequest} (`graphBuildProtocol.ts`); the worker posts
 *     the result back as bounded parts then a `done` head, reassembled here ({@link assembleBounded});
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
import { assembleBounded, PartsReceiver, postBounded } from "../workers/boundedTransfer";
import { folderKnowledge } from "./folderKnowledge";
import {
  EXTRACTED_REQUEST_ARRAYS, GRAPH_RESULT_ARRAYS, CODE_GRAPH_RESULT_ARRAYS,
  type GraphBuildRequest, type GraphWorkerMessage, type GraphWorkerReply, type StoredGraphRequest,
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
  resetPool();
  return () => { seams = prior; resetPool(); };
}

interface ActiveWorker {
  handle: GraphWorkerHandle;
  /** The entry whose build this worker is running (undefined between builds). */
  current?: QueueEntry;
}

/** The ONE reused worker and the builds waiting for it (only the head runs). */
const pool: { worker: ActiveWorker | undefined; queue: QueueEntry[] } = { worker: undefined, queue: [] };
let nextId = 1;

const resetPool = (): void => {
  pool.worker = undefined;
  pool.queue = [];
};

interface QueueEntry {
  id: number;
  request: GraphBuildRequest;
  signal?: AbortSignal;
  parts: PartsReceiver;
  resolve(result: KnowledgeGraph | CodeGraphFindings | null): void;
  reject(error: unknown): void;
  settled: boolean;
  settle(finish: () => void): void;
  onAbort(): void;
}

const resultArraysOf = (request: GraphBuildRequest): readonly string[] => (request.kind === "extracted" ? CODE_GRAPH_RESULT_ARRAYS : GRAPH_RESULT_ARRAYS);

/** Sends a request: an `extracted` array goes as bounded parts first, then `build` completes it. */
function sendRequest(worker: ActiveWorker, entry: QueueEntry): void {
  const send: (message: GraphWorkerMessage) => void = (m) => worker.handle.postMessage(m);
  if (entry.request.kind === "extracted") {
    const head = postBounded(send, entry.request, [...EXTRACTED_REQUEST_ARRAYS]);
    send({ type: "build", id: entry.id, request: head });
  } else {
    send({ type: "build", id: entry.id, request: entry.request });
  }
}

/** Spawns the reused worker and wires its replies to the queue. */
function attachWorker(): ActiveWorker {
  const file = seams.file === undefined ? workerFile() : seams.file;
  if (!file) throw new Error("graph_worker_unavailable");
  const handle = (seams.spawn ?? ((f: string) => new Worker(f) as unknown as GraphWorkerHandle))(file);
  const active: ActiveWorker = { handle };
  handle.on("message", (message: GraphWorkerReply) => {
    const entry = active.current;
    if (!entry || pool.worker !== active) return;
    if (entry.parts.accept(message)) return; // a slice of the result: kept until `done` completes it
    if (message.type === "done" && message.id === entry.id) {
      entry.settle(() => entry.resolve(assembleBounded(message.result, entry.parts, [...resultArraysOf(entry.request)])));
    } else if (message.type === "error" && message.id === entry.id) {
      entry.settle(() => entry.reject(Object.assign(new Error(message.error), message.code ? { code: message.code } : {})));
    } else {
      return; // a reply for a build nobody waits for: ignored
    }
    active.current = undefined;
    drain();
  });
  handle.on("error", (error: unknown) => {
    if (pool.worker !== active) return;
    pool.worker = undefined; // a crashed worker is not reused; the next build respawns
    const entry = active.current;
    active.current = undefined;
    if (entry) entry.settle(() => entry.reject(error instanceof Error ? error : new Error(String(error))));
    drain();
  });
  handle.on("exit", (code: number) => {
    if (pool.worker !== active) return;
    pool.worker = undefined;
    const entry = active.current;
    active.current = undefined;
    if (entry) entry.settle(() => entry.reject(new Error(`graph_worker_exit:${code}`)));
    drain();
  });
  pool.worker = active;
  return active;
}

/** Runs the queued builds one at a time on the (single reused) worker. */
function drain(): void {
  const entry = pool.queue[0];
  if (!entry || entry.settled) return;
  if (entry.signal?.aborted) {
    pool.queue.shift();
    entry.settle(() => entry.reject(aborted()));
    drain();
    return;
  }
  let active = pool.worker;
  if (!active) {
    try { active = attachWorker(); } catch (error) {
      pool.queue.shift();
      entry.settle(() => entry.reject(error));
      return;
    }
  }
  if (active.current) return; // a build is in flight: the head waits behind it, in arrival order
  active.current = entry;
  pool.queue.shift();
  sendRequest(active, entry);
}

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
    const entry: QueueEntry = {
      id: nextId++, request, signal, parts: new PartsReceiver(), settled: false,
      resolve: (r) => { resolve(r); }, reject: (e) => { reject(e); },
      settle(finish) {
        if (this.settled) return;
        this.settled = true;
        signal?.removeEventListener("abort", this.onAbort);
        finish();
      },
      onAbort: () => {
        if (entry.settled) return;
        const at = pool.queue.indexOf(entry);
        if (at >= 0) { pool.queue.splice(at, 1); entry.settle(() => entry.reject(aborted())); drain(); return; } // queued: dropped
        // In flight (this is the worker's current build): terminate the worker (a synchronous build
        // no flag could reach); the crash path respawns a fresh one for the next build.
        if (pool.worker?.current === entry) {
          const w = pool.worker;
          pool.worker = undefined;
          w.current = undefined;
          void w.handle.terminate();
          entry.settle(() => entry.reject(aborted()));
          drain();
        }
      },
    };
    signal?.addEventListener("abort", entry.onAbort, { once: true });
    pool.queue.push(entry);
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
