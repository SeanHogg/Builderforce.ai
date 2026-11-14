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
import { ExtractFailed } from "@seanhogg/builderforce-memory/knowledge";
/** PRD 41 A10 rule 2: an extract job that has not answered in 10 s is a `timeout` failure and its worker is recycled. */
export const JOB_TIMEOUT_MS = 10_000;
/** `min(availableParallelism() - 1, 8)`, at least 1: the host keeps a core for the editor. */
export function defaultExtractPoolSize(parallelism = typeof availableParallelism === "function" ? availableParallelism() : cpus().length) {
    return Math.min(8, Math.max(1, parallelism - 1));
}
const abortError = () => Object.assign(new Error("The review was stopped."), { name: "AbortError" });
export function createExtractPool(options) {
    const size = Math.max(1, Math.floor(options.size));
    const spawn = options.spawn ?? ((file, workerData) => new Worker(file, { workerData }));
    const slots = Array.from({ length: size }, () => ({}));
    const queue = [];
    const jobTimeoutMs = options.jobTimeoutMs ?? JOB_TIMEOUT_MS;
    let nextId = 0;
    let disposed = false;
    let down;
    const finish = (p, settle) => {
        if (p.settled)
            return;
        p.settled = true;
        if (p.timer)
            clearTimeout(p.timer);
        if (p.signal && p.onAbort)
            p.signal.removeEventListener("abort", p.onAbort);
        settle();
    };
    /** Drops the slot's worker (its events are ignored from now on) and stops it. */
    const retire = (slot) => {
        const worker = slot.worker;
        slot.worker = undefined;
        slot.current = undefined;
        slot.ready = false;
        try {
            void Promise.resolve(worker?.terminate()).catch(() => undefined);
        }
        catch {
            // Already gone.
        }
    };
    /** Runs a job through the in-thread fallback and settles it with the result. */
    const viaFallback = (p) => {
        if (p.signal?.aborted) {
            finish(p, () => p.reject(abortError()));
            return;
        }
        options.fallback(p.job, p.signal).then((result) => finish(p, () => p.resolve(result)), (error) => finish(p, () => p.reject(error instanceof Error ? error : new Error(String(error)))));
    };
    /** The workers never loaded: everything, from now on, runs in this thread. */
    const goDown = (reason, held) => {
        if (down === undefined) {
            down = reason;
            options.onDown?.(reason);
        }
        const waiting = held ? [held, ...queue.splice(0)] : queue.splice(0);
        for (const slot of slots) {
            const mine = slot.current;
            retire(slot);
            if (mine && mine !== held)
                waiting.push(mine);
        }
        for (const p of waiting)
            viaFallback(p);
    };
    const failSlot = (slot, worker, reason) => {
        if (slot.worker !== worker)
            return; // already retired (terminated on abort)
        const held = slot.current;
        const neverLoaded = !slot.ready;
        if (neverLoaded && options.fallback) {
            goDown(reason, held);
            return;
        }
        retire(slot);
        if (held)
            finish(held, () => held.reject(new Error(reason)));
        dispatch();
    };
    const start = (slot) => {
        const worker = spawn(options.workerFile, options.workerData);
        slot.worker = worker;
        slot.ready = false;
        worker.on("message", (reply) => {
            if ("ready" in reply) {
                if (slot.worker === worker)
                    slot.ready = true;
                return;
            }
            const held = slot.current;
            if (slot.worker !== worker || !held || held.id !== reply.id)
                return;
            slot.current = undefined;
            finish(held, () => ("error" in reply ? held.reject(reply.final ? new ExtractFailed(reply.error) : new Error(reply.error)) : held.resolve(reply.result)));
            dispatch();
        });
        worker.on("error", (error) => failSlot(slot, worker, `The extraction worker crashed: ${error instanceof Error ? error.message : String(error)}`));
        worker.on("exit", (code) => failSlot(slot, worker, `The extraction worker exited (code ${code}).`));
        return worker;
    };
    function dispatch() {
        if (disposed || down !== undefined)
            return;
        for (const slot of slots) {
            if (slot.current)
                continue;
            // A queued job whose review was already stopped is not worth a worker.
            let next = queue.shift();
            while (next?.signal?.aborted) {
                const dead = next;
                finish(dead, () => dead.reject(abortError()));
                next = queue.shift();
            }
            if (!next)
                return;
            slot.current = next;
            try {
                (slot.worker ?? start(slot)).postMessage({ id: next.id, job: next.job });
                if (jobTimeoutMs > 0) {
                    const timed = next;
                    timed.timer = setTimeout(() => {
                        if (timed.settled)
                            return;
                        if (slots.find((s) => s.current === timed))
                            retire(slots.find((s) => s.current === timed));
                        finish(timed, () => timed.reject(new Error("timeout")));
                        dispatch();
                    }, jobTimeoutMs);
                }
            }
            catch (error) {
                const reason = `The extraction worker could not start: ${error instanceof Error ? error.message : String(error)}`;
                const held = next;
                if (options.fallback) {
                    slot.current = undefined;
                    goDown(reason, held);
                    return;
                }
                retire(slot);
                finish(held, () => held.reject(new Error(reason)));
            }
        }
    }
    const pool = (job, signal) => new Promise((resolve, reject) => {
        if (disposed) {
            reject(new Error("The extraction pool was disposed."));
            return;
        }
        if (signal?.aborted) {
            reject(abortError());
            return;
        }
        const pending = { id: ++nextId, job, settled: false, resolve, reject, ...(signal ? { signal } : {}) };
        if (signal) {
            pending.onAbort = () => {
                const queued = queue.indexOf(pending);
                if (queued >= 0)
                    queue.splice(queued, 1);
                const slot = slots.find((s) => s.current === pending);
                if (slot)
                    retire(slot); // a running job: stop its worker; the next job starts a fresh one
                finish(pending, () => reject(abortError()));
                dispatch();
            };
            signal.addEventListener("abort", pending.onAbort, { once: true });
        }
        if (down !== undefined) {
            viaFallback(pending);
            return;
        }
        queue.push(pending);
        dispatch();
    });
    return {
        pool,
        size,
        state: () => (down === undefined ? {} : { down }),
        warm() {
            if (disposed || down !== undefined)
                return;
            for (const slot of slots) {
                if (slot.worker)
                    continue;
                try {
                    start(slot);
                }
                catch (error) {
                    const reason = `The extraction worker could not start: ${error instanceof Error ? error.message : String(error)}`;
                    if (options.fallback) {
                        goDown(reason);
                        return;
                    }
                }
            }
        },
        dispose() {
            disposed = true;
            for (const p of queue.splice(0))
                finish(p, () => p.reject(new Error("The extraction pool was disposed.")));
            for (const slot of slots) {
                const held = slot.current;
                retire(slot);
                if (held)
                    finish(held, () => held.reject(new Error("The extraction pool was disposed.")));
            }
        },
    };
}
//# sourceMappingURL=extractPool.js.map