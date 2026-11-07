/**
 * The review's extraction pool (PRD 41 A8): memory's `ExtractPool` port over `worker_threads`, so
 * the CPU-bound parsing of a re-review leaves the extension host's thread.
 *
 * - FIFO dispatch, ONE job in flight per worker, workers started lazily on first use.
 * - `signal`: an aborted job is rejected; if it was running, its worker is terminated (and respawned
 *   when the next job needs one), so Stop never waits for a long parse. A queued job whose signal
 *   is already aborted is skipped when its turn comes.
 * - A worker that crashes or exits AFTER it announced `{ ready: true }` (its module loaded) rejects only the job
 *   it held, with the reason, and is respawned: a file that crashes a fresh worker is a failed file, not a down pool.
 * - A worker that dies BEFORE it announced ready (it never loaded) takes the whole pool DOWN for the
 *   session when a `fallback` is given: the job it held and every later one run through `fallback`
 *   (the very same extraction code, in-thread), so a broken worker is never a failed file. The
 *   reason is kept in {@link ExtractPoolHandle.state}.
 *
 * Pure over a `spawn` seam (default: a real `Worker`), so it is tested without threads.
 */

import { availableParallelism, cpus } from "node:os";
import { Worker } from "node:worker_threads";
import type { ExtractJob, ExtractJobResult, ExtractPool } from "@seanhogg/builderforce-memory/knowledge";

/** What the pool uses of a `worker_threads` Worker (a test hands in its own). */
export interface PoolWorker {
  postMessage(message: unknown): void;
  on(event: "message" | "error" | "exit", listener: (value: any) => void): unknown;
  terminate(): Promise<number> | void;
}

/** A worker's answer to one `{ id, job }` message. */
export type WorkerReply = { id: number; result: ExtractJobResult } | { id: number; error: string } | { ready: true };

export interface ExtractPoolOptions {
  /** Workers at most (see {@link defaultExtractPoolSize}). */
  size: number;
  /** The worker's script (`out/knowledgeExtractWorker.js`). */
  workerFile: string;
  /** Handed to each worker as its `workerData`. */
  workerData?: unknown;
  /** Starts a worker; default a real `worker_threads` Worker. */
  spawn?: (file: string, workerData?: unknown) => PoolWorker;
  /** Extracts a job in this thread. Given ⇒ a worker that never loads takes the pool down to it instead of failing files. */
  fallback?: (job: ExtractJob, signal?: AbortSignal) => Promise<ExtractJobResult>;
  /** Told once, when the pool goes down, why. */
  onDown?: (reason: string) => void;
}

export interface ExtractPoolHandle {
  pool: ExtractPool;
  size: number;
  /** `down` is why parallel extraction is unavailable (jobs run through the fallback); absent while it works. */
  state(): { down?: string };
  /** Rejects what is waiting or running and terminates every worker. */
  dispose(): void;
}

/** `min(availableParallelism() - 1, 8)`, at least 1: the host keeps a core for the editor. */
export function defaultExtractPoolSize(parallelism: number = typeof availableParallelism === "function" ? availableParallelism() : cpus().length): number {
  return Math.min(8, Math.max(1, parallelism - 1));
}

const abortError = (): Error => Object.assign(new Error("The review was stopped."), { name: "AbortError" });

interface Pending {
  id: number;
  job: ExtractJob;
  settled: boolean;
  resolve(result: ExtractJobResult): void;
  reject(error: Error): void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface Slot {
  worker?: PoolWorker;
  current?: Pending;
  /** The current worker announced `{ ready: true }`: its module loaded, so a later death is a crash, not a failed start. */
  ready?: boolean;
}

export function createExtractPool(options: ExtractPoolOptions): ExtractPoolHandle {
  const size = Math.max(1, Math.floor(options.size));
  const spawn = options.spawn ?? ((file: string, workerData?: unknown) => new Worker(file, { workerData }) as unknown as PoolWorker);
  const slots: Slot[] = Array.from({ length: size }, () => ({}));
  const queue: Pending[] = [];
  let nextId = 0;
  let disposed = false;
  let down: string | undefined;

  const finish = (p: Pending, settle: () => void): void => {
    if (p.settled) return;
    p.settled = true;
    if (p.signal && p.onAbort) p.signal.removeEventListener("abort", p.onAbort);
    settle();
  };

  /** Drops the slot's worker (its events are ignored from now on) and stops it. */
  const retire = (slot: Slot): void => {
    const worker = slot.worker;
    slot.worker = undefined;
    slot.current = undefined;
    slot.ready = false;
    try {
      void Promise.resolve(worker?.terminate()).catch(() => undefined);
    } catch {
      // Already gone.
    }
  };

  /** Runs a job through the in-thread fallback and settles it with the result. */
  const viaFallback = (p: Pending): void => {
    if (p.signal?.aborted) { finish(p, () => p.reject(abortError())); return; }
    options.fallback!(p.job, p.signal).then(
      (result) => finish(p, () => p.resolve(result)),
      (error: unknown) => finish(p, () => p.reject(error instanceof Error ? error : new Error(String(error)))),
    );
  };

  /** The workers never loaded: everything, from now on, runs in this thread. */
  const goDown = (reason: string, held?: Pending): void => {
    if (down === undefined) {
      down = reason;
      options.onDown?.(reason);
    }
    const waiting = held ? [held, ...queue.splice(0)] : queue.splice(0);
    for (const slot of slots) {
      const mine = slot.current;
      retire(slot);
      if (mine && mine !== held) waiting.push(mine);
    }
    for (const p of waiting) viaFallback(p);
  };

  const failSlot = (slot: Slot, worker: PoolWorker, reason: string): void => {
    if (slot.worker !== worker) return; // already retired (terminated on abort)
    const held = slot.current;
    const neverLoaded = !slot.ready;
    if (neverLoaded && options.fallback) { goDown(reason, held); return; }
    retire(slot);
    if (held) finish(held, () => held.reject(new Error(reason)));
    dispatch();
  };

  const start = (slot: Slot): PoolWorker => {
    const worker = spawn(options.workerFile, options.workerData);
    slot.worker = worker;
    slot.ready = false;
    worker.on("message", (reply: WorkerReply) => {
      if ("ready" in reply) { if (slot.worker === worker) slot.ready = true; return; }
      const held = slot.current;
      if (slot.worker !== worker || !held || held.id !== reply.id) return;
      slot.current = undefined;
      finish(held, () => ("error" in reply ? held.reject(new Error(reply.error)) : held.resolve(reply.result)));
      dispatch();
    });
    worker.on("error", (error: unknown) => failSlot(slot, worker, `The extraction worker crashed: ${error instanceof Error ? error.message : String(error)}`));
    worker.on("exit", (code: number) => failSlot(slot, worker, `The extraction worker exited (code ${code}).`));
    return worker;
  };

  function dispatch(): void {
    if (disposed || down !== undefined) return;
    for (const slot of slots) {
      if (slot.current) continue;
      // A queued job whose review was already stopped is not worth a worker.
      let next = queue.shift();
      while (next?.signal?.aborted) {
        const dead = next;
        finish(dead, () => dead.reject(abortError()));
        next = queue.shift();
      }
      if (!next) return;
      slot.current = next;
      try {
        (slot.worker ?? start(slot)).postMessage({ id: next.id, job: next.job });
      } catch (error) {
        const reason = `The extraction worker could not start: ${error instanceof Error ? error.message : String(error)}`;
        const held = next;
        if (options.fallback) { slot.current = undefined; goDown(reason, held); return; }
        retire(slot);
        finish(held, () => held.reject(new Error(reason)));
      }
    }
  }

  const pool: ExtractPool = (job, signal) =>
    new Promise<ExtractJobResult>((resolve, reject) => {
      if (disposed) { reject(new Error("The extraction pool was disposed.")); return; }
      if (signal?.aborted) { reject(abortError()); return; }
      const pending: Pending = { id: ++nextId, job, settled: false, resolve, reject, ...(signal ? { signal } : {}) };
      if (signal) {
        pending.onAbort = () => {
          const queued = queue.indexOf(pending);
          if (queued >= 0) queue.splice(queued, 1);
          const slot = slots.find((s) => s.current === pending);
          if (slot) retire(slot); // a running job: stop its worker; the next job starts a fresh one
          finish(pending, () => reject(abortError()));
          dispatch();
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      if (down !== undefined) { viaFallback(pending); return; }
      queue.push(pending);
      dispatch();
    });

  return {
    pool,
    size,
    state: () => (down === undefined ? {} : { down }),
    dispose() {
      disposed = true;
      for (const p of queue.splice(0)) finish(p, () => p.reject(new Error("The extraction pool was disposed.")));
      for (const slot of slots) {
        const held = slot.current;
        retire(slot);
        if (held) finish(held, () => held.reject(new Error("The extraction pool was disposed.")));
      }
    },
  };
}
