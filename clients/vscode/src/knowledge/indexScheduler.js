/**
 * The background indexer's priority queue and its slice runner (PRD 41 B6 "Scheduling") — pure over a clock and a gate.
 *
 * Priorities, lowest first: files open in editors, visible files, files within 2 import hops of an open one (`near`, by
 * the root's fact graph), recently committed files, everything else. A path
 * queued twice keeps its best priority (a promoted one joins the end of its better bucket). The runner drains the queue in
 * slices sized to `SLICE_MS` from the measured cost per file, hands the event loop back between slices, and stops
 * at a slice boundary whenever the gate reports a pause (a keystroke, a long-unfocused window); {@link SliceRunner.kick}
 * resumes it.
 */
import { nextSliceSize } from "./indexBudget";
export const PRIORITY = { open: 0, visible: 1, near: 2, recent: 3, rest: 4 };
/** One insertion-ordered bucket per priority: a push and a take cost O(1) per path, never a sort of the queue. */
export class IndexQueue {
    buckets = new Map();
    priorityOf = new Map();
    push(path, priority) {
        const held = this.priorityOf.get(path);
        if (held !== undefined) {
            if (priority >= held)
                return;
            this.buckets.get(held)?.delete(path); // promoted: it joins the end of its better bucket
        }
        this.priorityOf.set(path, priority);
        let bucket = this.buckets.get(priority);
        if (!bucket)
            this.buckets.set(priority, (bucket = new Set()));
        bucket.add(path);
    }
    get size() { return this.priorityOf.size; }
    /** The `n` best queued paths (priority, then arrival in that bucket), removed from the queue. */
    take(n) {
        const out = [];
        for (const priority of [...this.buckets.keys()].sort((a, b) => a - b)) {
            const bucket = this.buckets.get(priority);
            for (const path of bucket) {
                if (out.length >= n)
                    return out;
                bucket.delete(path);
                this.priorityOf.delete(path);
                out.push(path);
            }
            if (bucket.size === 0)
                this.buckets.delete(priority);
        }
        return out;
    }
    clear() { this.buckets.clear(); this.priorityOf.clear(); }
}
export class SliceRunner {
    queue;
    deps;
    running;
    stopped = false;
    msPerFile;
    constructor(queue, deps) {
        this.queue = queue;
        this.deps = deps;
    }
    /** Starts a drain unless one is running; resolves when that drain stops (empty, paused or stopped). */
    kick() {
        if (this.stopped)
            return Promise.resolve();
        this.running ??= this.drain().finally(() => { this.running = undefined; });
        return this.running;
    }
    get busy() { return this.running !== undefined; }
    /** Resolves when the drain running now (if any) has stopped — after its slice in flight, once `pausedBy` reports a pause or `stop`. */
    settled() {
        return this.running ?? Promise.resolve();
    }
    stop() {
        this.stopped = true;
        this.queue.clear();
    }
    yieldTurn() {
        return this.deps.yieldTurn ? this.deps.yieldTurn() : new Promise((resolve) => { this.deps.clock.setTimeout(resolve, 0); });
    }
    async drain() {
        while (!this.stopped && this.queue.size > 0) {
            const paused = this.deps.pausedBy();
            if (paused) {
                this.deps.onPaused?.(paused);
                return;
            }
            const batch = this.queue.take(nextSliceSize(this.msPerFile));
            const started = this.deps.clock.now();
            try {
                await this.deps.work(batch);
            }
            catch (error) {
                this.deps.onError?.(error);
            }
            const per = (this.deps.clock.now() - started) / batch.length;
            // A moving average: one slow file (a cold read) does not shrink every later slice to one file.
            this.msPerFile = this.msPerFile === undefined ? per : this.msPerFile * 0.7 + per * 0.3;
            await this.yieldTurn();
        }
        if (!this.stopped && this.queue.size === 0)
            this.deps.onDrained?.();
    }
}
//# sourceMappingURL=indexScheduler.js.map