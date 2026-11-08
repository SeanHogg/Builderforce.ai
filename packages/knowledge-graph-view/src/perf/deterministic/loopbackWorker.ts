/**
 * The REAL worker loop (`createWorkerHost`, the very code `graphCompute.worker.ts` binds to `self`) run in this process, with
 * everything that varies between runs taken out: no thread, no timing. It exists to MEASURE, so it does three things a worker
 * does not:
 *
 *  - every message that crosses is recorded in the {@link WireLedger} (exact bytes, transfer list, graph elements inside) before
 *    it is structured-cloned, and the clone really transfers, so a buffer is detached exactly as `postMessage` would;
 *  - the elements the worker receives are wrapped in the WORKER's own {@link WorkMeter}, so its reads are counted apart from the
 *    main thread's, and each task's steps are wrapped to give a per-step ledger ({@link TaskRun});
 *  - delivery is deterministic: one FIFO holds every delivery and every `tick()` the host asks for, and `settle()` drains it one
 *    item at a time, letting the client's own zero-delay timers (the upload's macrotask between slices) run in between. Nothing
 *    is delivered synchronously from `postMessage`, as in a browser.
 *
 * The ledgers hold only counts and bytes: no wall-clock is read anywhere.
 */

import type { TaskKind, WorkerIn, WorkerOut } from '../../compute/protocol';
import { HANDLERS } from '../../compute/tasks';
import { createWorkerHost, type WorkerHost } from '../../compute/workerHost';
import type { WorkerLike } from '../../compute/workerFactory';
import { unwrapDeep, type WorkMeter } from './meter';
import { WireLedger } from './wireLedger';

/** What one task did in the worker: how many steps, and graph-element reads in all and in the busiest step. */
export interface TaskRun { kind: TaskKind; steps: number; totalReads: number; maxReadsPerStep: number }

export interface LoopbackMeters { main: WorkMeter; worker: WorkMeter }

/** A safety stop for `settle` (turns of the loop), so a task that never ends fails the test instead of hanging it. */
const MAX_TURNS = 5_000_000;

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class LoopbackWorker implements WorkerLike {
    onmessage: WorkerLike['onmessage'] = null;
    onerror: WorkerLike['onerror'] = null;
    onmessageerror: WorkerLike['onmessageerror'] = null;

    /** Every message in either direction. */
    readonly ledger: WireLedger;
    /** One entry per task the worker ran, in the order it started them. */
    readonly tasks: TaskRun[] = [];

    private readonly queue: Array<() => void> = [];
    private readonly kinds = new Map<number, TaskKind>();
    private readonly host: WorkerHost;
    private dead = false;

    constructor(private readonly meters: LoopbackMeters) {
        const both = (v: unknown): boolean => meters.main.isElement(v) || meters.worker.isElement(v);
        this.ledger = new WireLedger(both, (v) => unwrapDeep(v, [meters.main, meters.worker]));
        this.host = createWorkerHost({
            reply: (message, transfer) => this.reply(message, transfer),
            tick: () => new Promise<void>((resolve) => { this.queue.push(resolve); }),
            handlers: this.measured(),
        });
    }

    postMessage(message: WorkerIn, transfer: Transferable[] = []): void {
        if (this.dead) return;
        if (message.type === 'run') this.kinds.set(message.id, message.kind);
        const cloned = this.quiet(() => {
            this.ledger.record('in', message, transfer as ArrayBuffer[]);
            return structuredClone(unwrapDeep(message, [this.meters.main]), { transfer });
        });
        const delivered = cloned.type === 'load-chunk' && Array.isArray(cloned.items) ? { ...cloned, items: this.meters.worker.wrapArray(cloned.items) } : cloned;
        this.queue.push(() => this.host.handle(delivered));
    }

    terminate(): void {
        this.dead = true;
        this.queue.length = 0;
    }

    /** True when nothing is queued and the worker has no task. */
    idle(): boolean { return this.queue.length === 0 && this.host.idle(); }

    /**
     * Runs the loop until it is quiet: the queue empty and the worker idle for two turns in a row (a turn lets zero-delay timers
     * and promise chains run). Returns how many items it delivered, so a caller can tell a round that did something.
     */
    async settle(): Promise<number> {
        let quiet = 0, ran = 0;
        for (let turns = 0; quiet < 2; turns++) {
            if (turns > MAX_TURNS) throw new Error('loopback worker: settle() did not converge');
            const job = this.queue.shift();
            if (job) { quiet = 0; ran++; job(); } else if (this.host.idle()) quiet++; else quiet = 0;
            await macrotask();
        }
        return ran;
    }

    /** Runs `fn` with neither meter counting (the rig's own cloning and serialising is not the code under test). */
    private quiet<T>(fn: () => T): T { return this.meters.main.without(() => this.meters.worker.without(fn)); }

    private reply(message: WorkerOut, transfer: Transferable[]): void {
        if (this.dead) return;
        const data = this.quiet(() => {
            this.ledger.record('out', message, transfer as ArrayBuffer[], this.kinds.get(message.id));
            return structuredClone(unwrapDeep(message, [this.meters.main, this.meters.worker]), { transfer });
        });
        this.queue.push(() => this.onmessage?.({ data }));
    }

    /** The real task table with every task's steps counted against the worker meter. */
    private measured(): typeof HANDLERS {
        const meter = this.meters.worker;
        const table: Record<string, unknown> = {};
        for (const kind of Object.keys(HANDLERS) as TaskKind[]) {
            const real = HANDLERS[kind] as (store: unknown, req: unknown) => { step(): boolean; result(): unknown };
            table[kind] = (store: unknown, req: unknown) => {
                const run: TaskRun = { kind, steps: 0, totalReads: 0, maxReadsPerStep: 0 };
                this.tasks.push(run);
                const built = meter.mark();
                const task = real(store, req);
                let carry = meter.since(built); // reads made while the handler was set up belong to its first step
                return {
                    step: (): boolean => {
                        const at = meter.mark();
                        const done = task.step();
                        const reads = meter.since(at) + carry;
                        carry = 0;
                        run.steps++; run.totalReads += reads; run.maxReadsPerStep = Math.max(run.maxReadsPerStep, reads);
                        return done;
                    },
                    result: (): unknown => {
                        const at = meter.mark();
                        const value = task.result();
                        run.totalReads += meter.since(at);
                        return value;
                    },
                };
            };
        }
        return table as unknown as typeof HANDLERS;
    }
}
