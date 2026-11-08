/**
 * The graph compute worker: holds graphs resident and runs the named tasks against them with the SAME pure functions
 * the main thread used to run (`tasks/`). It sends back indices, typed arrays and small plain data; never nodes or edges.
 *
 * Tasks run one at a time, first come first served. A task of several steps yields to the event loop between steps, which
 * is what lets a `cancel` (the view moved on) reach a task that has not started or is between steps; a step itself cannot
 * be interrupted.
 */

import type { WorkerIn, WorkerOut } from './protocol';
import { ComputeStore } from './store';
import { HANDLERS } from './tasks';
import { transferablesOf } from './transfer';

interface Run { id: number; graph: number; kind: keyof typeof HANDLERS; req: unknown }

const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerIn>) => void) | null; postMessage(message: WorkerOut, transfer?: Transferable[]): void };
const store = new ComputeStore();
const queue: Run[] = [];
const cancelled = new Set<number>();
let pumping = false;

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const reply = (message: WorkerOut, transfer: Transferable[] = []): void => scope.postMessage(message, transfer);

async function execute(run: Run): Promise<void> {
    if (cancelled.delete(run.id)) return;
    if (!store.has(run.graph)) { reply({ type: 'failed', id: run.id, graph: run.graph, message: `graph ${run.graph} is not resident` }); return; }
    try {
        const task = (HANDLERS[run.kind] as (s: ComputeStore, r: unknown) => { step(): boolean; result(): unknown })(store, run.req);
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

scope.onmessage = (event) => {
    const m = event.data;
    switch (m.type) {
        case 'load-begin': store.begin(m.graph, m.shell, m.outline); break;
        case 'load-chunk': store.chunk(m.graph, m.field, m.items); break;
        case 'load-end': store.end(m.graph); break;
        case 'drop': store.drop(m.graph); break;
        case 'cancel': cancelled.add(m.id); break;
        case 'run': queue.push({ id: m.id, graph: m.graph, kind: m.kind, req: m.req }); void pump(); break;
    }
};
