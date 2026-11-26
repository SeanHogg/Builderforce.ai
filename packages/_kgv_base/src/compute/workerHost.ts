/**
 * The graph compute worker's message loop, with its two edges (where replies go, how to yield) passed in. It holds graphs
 * resident and runs the named tasks against them with the SAME pure functions the main thread used to run (`tasks/`). It
 * sends back indices, typed arrays and small plain data; never nodes or edges.
 *
 * Tasks run one at a time, first come first served. A task of several steps yields to the event loop between steps, which
 * is what lets a `cancel` (the view moved on) reach a task that has not started or is between steps; a step itself cannot
 * be interrupted.
 *
 * Why a factory: the worker file binds it to `self`, and a profiler (or a test) binds it to plain functions, so the loop
 * that is measured is the loop that ships.
 */

import type { WorkerIn, WorkerOut } from './protocol';
import { ComputeStore } from './store';
import { HANDLERS } from './tasks';
import { transferablesOf } from './transfer';

export interface WorkerHostDeps {
    /** Sends a reply to the main thread (the worker's postMessage). */
    reply(message: WorkerOut, transfer: Transferable[]): void;
    /** Yields between steps and between tasks (the worker uses setTimeout 0). */
    tick(): Promise<void>;
    /** The task table (default HANDLERS). A profiler passes a wrapped copy. */
    handlers?: typeof HANDLERS;
    /** Default: a new ComputeStore. */
    store?: ComputeStore;
}

export interface WorkerHost {
    handle(message: WorkerIn): void;
    readonly store: ComputeStore;
    /** True when no task is queued or running. */
    idle(): boolean;
}

interface Run { id: number; graph: number; kind: keyof typeof HANDLERS; req: unknown }

export function createWorkerHost(deps: WorkerHostDeps): WorkerHost {
    const { tick } = deps;
    const handlers = deps.handlers ?? HANDLERS;
    const store = deps.store ?? new ComputeStore();
    const queue: Run[] = [];
    const cancelled = new Set<number>();
    let pumping = false;

    const reply = (message: WorkerOut, transfer: Transferable[] = []): void => deps.reply(message, transfer);

    async function execute(run: Run): Promise<void> {
        if (cancelled.delete(run.id)) return;
        if (!store.has(run.graph)) { reply({ type: 'failed', id: run.id, graph: run.graph, message: `graph ${run.graph} is not resident` }); return; }
        try {
            const task = (handlers[run.kind] as (s: ComputeStore, r: unknown) => { step(): boolean; result(): unknown })(store, run.req);
            let done = false;
            while (!done) {
                done = task.step();
                if (!done) {
                    await tick();
                    if (cancelled.delete(run.id)) return;
                }
            }
            if (cancelled.delete(run.id)) return;
            const raw = task.result();
            reply({ type: 'done', id: run.id, graph: run.graph, raw }, transferablesOf(raw));
        } catch (error) {
            reply({ type: 'failed', id: run.id, graph: run.graph, message: error instanceof Error ? error.message : String(error) });
        }
    }

    async function pump(): Promise<void> {
        if (pumping) return;
        pumping = true;
        try {
            for (let run = queue.shift(); run; run = queue.shift()) {
                await execute(run);
                await tick(); // let the messages that arrived meanwhile (a cancel, a load) be handled before the next task
            }
        } finally {
            pumping = false;
            cancelled.clear(); // a cancel for a task that had already finished
        }
    }

    function handle(m: WorkerIn): void {
        switch (m.type) {
            case 'load-begin': store.begin(m.graph, m.shell, m.outline); break;
            case 'load-chunk': store.chunk(m.graph, m.field, m.items); break;
            case 'load-end': store.end(m.graph); break;
            case 'drop': store.drop(m.graph); break;
            case 'cancel': cancelled.add(m.id); break;
            case 'run': queue.push({ id: m.id, graph: m.graph, kind: m.kind, req: m.req }); void pump(); break;
        }
    }

    return { handle, store, idle: () => !pumping && queue.length === 0 };
}
