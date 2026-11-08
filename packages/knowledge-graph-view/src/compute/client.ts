/**
 * The compute client: how a component asks for a heavy computation without running it on the main thread.
 *
 * `run(kind, input, callbacks)` encodes the input (naming graph elements by index), asks the worker, and decodes the reply
 * back onto the caller's own objects. Superseded requests are cancelled; a reply whose request was cancelled, or whose graph
 * has since been dropped, is ignored (stale). The graph is posted to the worker once, in slices, when a task first needs it.
 *
 * FALLBACK. With no `Worker` (jsdom, a server render), or when the worker cannot be built or dies (a host CSP that blocks
 * it), the same handlers run in-process through the idle-step scheduler: identical results, on the main thread. Nothing
 * else in the package knows which mode it is in.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { runIdleTask } from '../useIdleSteps';
import { CODECS } from './codecs';
import type { KindInput, KindResult } from './kinds';
import type { GraphId, LoadField, TaskKind, TaskTable, WorkerIn, WorkerOut } from './protocol';
import { Residency, type GraphHandle } from './residency';
import { ComputeStore } from './store';
import { HANDLERS } from './tasks';

/** The slice of a Worker the client uses (so a test can hand in a fake). */
export interface WorkerLike {
    postMessage(message: WorkerIn, transfer?: Transferable[]): void;
    terminate(): void;
    onmessage: ((event: { data: WorkerOut }) => void) | null;
    onerror: ((event: unknown) => void) | null;
}

/** Builds the worker, or returns null when this runtime has none. Throws when it has one it cannot start. */
export type Spawn = () => WorkerLike | null;

export interface Callbacks<R> { done(result: R): void; fail(error: unknown): void }

/** Elements per slice of a graph posted to the worker: a few milliseconds of cloning each, so no frame is lost to one. */
const SLICE = 8000;
/** How long the worker is kept after its last user is gone (a remount in this window finds the graph still loaded). */
const KEEP_ALIVE_MS = 10_000;

interface Pending {
    graph: GraphId;
    posted: boolean;
    /** Delivers the reply. */
    receive(raw: unknown): void;
    fail(error: unknown): void;
    /** Runs the same request in-process (after the worker is gone). */
    rerun(): void;
}

const macrotask = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class ComputeClient {
    readonly residency = new Residency((id) => this.evict(id));
    private readonly local = new ComputeStore();
    private worker: WorkerLike | null = null;
    private inProcess: boolean;
    private warned = false;
    private users = 0;
    private lingering: ReturnType<typeof setTimeout> | null = null;
    private seq = 0;
    private readonly pending = new Map<number, Pending>();
    private readonly loads = new Map<GraphId, Promise<void>>();

    constructor(private readonly spawn: Spawn) {
        // Decided once: a runtime with no worker never has one.
        this.inProcess = false;
        try {
            this.worker = spawn();
        } catch (error) {
            this.warn(error);
        }
        if (!this.worker) this.inProcess = true;
        else this.attach(this.worker);
    }

    /** True while tasks run on the main thread. */
    get isInProcess(): boolean { return this.inProcess; }

    /** A user (a mounted view) wants the worker kept. Balanced by {@link release}. */
    retain(): void {
        this.users++;
        if (this.lingering) { clearTimeout(this.lingering); this.lingering = null; }
        if (this.users === 1 && !this.worker && !this.inProcess) this.revive();
    }

    release(): void {
        this.users = Math.max(0, this.users - 1);
        if (this.users === 0 && this.worker && !this.lingering) this.lingering = setTimeout(() => this.retire(), KEEP_ALIVE_MS);
    }

    /** Posts `graph` to the worker ahead of the first task that needs it (a no-op in-process). */
    prefetch(graph: KnowledgeGraph): void {
        const id = this.residency.graphId(graph);
        if (this.worker) void this.ensureLoaded(id);
    }

    /** Computes on the main thread, now, with the same handler: for the small graphs where a round trip would cost more than the work. */
    runSync<K extends TaskKind>(kind: K, input: KindInput<K>): KindResult<K> {
        const { graph, req } = this.encode(kind, input);
        const task = HANDLERS[kind](this.adopted(graph), req as never);
        while (!task.step());
        return CODECS[kind].decode(task.result() as never, input as never) as KindResult<K>;
    }

    /** Asks for a computation; returns the function that cancels it. At most one of the callbacks is called, and none after the cancel. */
    run<K extends TaskKind>(kind: K, input: KindInput<K>, callbacks: Callbacks<KindResult<K>>): () => void {
        let live = true;
        const deliver = (raw: TaskTable[K]['raw']): void => {
            if (!live) return;
            try { callbacks.done(CODECS[kind].decode(raw as never, input as never) as KindResult<K>); } catch (error) { callbacks.fail(error); }
        };
        let encoded: { graph: GraphId; req: TaskTable[K]['req'] };
        try { encoded = this.encode(kind, input); } catch (error) { callbacks.fail(error); return () => undefined; }
        const { graph, req } = encoded;

        let stop = (): void => undefined;
        const inProcess = (): void => {
            stop = runIdleTask(() => HANDLERS[kind](this.adopted(graph), req as never), (raw) => deliver(raw as TaskTable[K]['raw']), (e) => { if (live) callbacks.fail(e); });
        };
        if (this.inProcess || !this.worker) {
            inProcess();
        } else {
            const id = ++this.seq;
            const entry: Pending = {
                graph, posted: false,
                receive: (raw) => deliver(raw as TaskTable[K]['raw']),
                fail: (e) => { if (live) callbacks.fail(e); },
                rerun: inProcess,
            };
            this.pending.set(id, entry);
            void this.ensureLoaded(graph).then(() => {
                if (!live || this.pending.get(id) !== entry || !this.worker) return;
                entry.posted = true;
                this.worker.postMessage({ type: 'run', id, graph, kind, req });
            });
            stop = () => {
                if (this.pending.delete(id) && entry.posted) this.worker?.postMessage({ type: 'cancel', id });
            };
        }
        return () => { live = false; stop(); };
    }

    /** `run` as a promise, for a handler that needs the answer once. */
    once<K extends TaskKind>(kind: K, input: KindInput<K>): Promise<KindResult<K>> {
        this.retain();
        return new Promise<KindResult<K>>((resolve, reject) => { this.run(kind, input, { done: resolve, fail: reject }); }).finally(() => this.release());
    }

    private encode<K extends TaskKind>(kind: K, input: KindInput<K>): { graph: GraphId; req: TaskTable[K]['req'] } {
        return (CODECS[kind].encode as (i: KindInput<K>, r: Residency) => { graph: GraphId; req: TaskTable[K]['req'] })(input, this.residency);
    }

    /** The in-process store with `graph` in it (the main thread's own graph, not a copy). */
    private adopted(graph: GraphId): ComputeStore {
        if (!this.local.has(graph)) {
            const handle = this.residency.handleOf(graph);
            if (!handle) throw new Error(`compute: graph ${graph} was dropped`);
            this.local.adopt(graph, handle.graph);
        }
        return this.local;
    }

    private evict(id: GraphId): void {
        this.local.drop(id);
        this.loads.delete(id);
        this.worker?.postMessage({ type: 'drop', graph: id });
    }

    private attach(worker: WorkerLike): void {
        worker.onmessage = (event) => this.receive(event.data);
        worker.onerror = (event) => this.failOver(event);
    }

    private receive(message: WorkerOut): void {
        const entry = this.pending.get(message.id);
        if (!entry) return; // cancelled
        this.pending.delete(message.id);
        if (!this.residency.isLive(message.graph)) return; // the graph it was computed for is gone: stale
        if (message.type === 'done') entry.receive(message.raw);
        else entry.fail(new Error(message.message));
    }

    /** The graph in the worker: posted once, in slices, and awaited by every task that needs it. */
    private ensureLoaded(id: GraphId): Promise<void> {
        let load = this.loads.get(id);
        if (!load) {
            const handle = this.residency.handleOf(id);
            load = handle && this.worker ? this.stream(handle, this.worker) : Promise.resolve();
            this.loads.set(id, load);
        }
        return load;
    }

    private async stream(handle: GraphHandle, worker: WorkerLike): Promise<void> {
        const { id } = handle;
        const { nodes, edges, findings, outline, ...shell } = handle.graph;
        const { files, links, ...outlineShell } = outline ?? { files: [], links: [] as Array<[number, number, number, number]> };
        const post = (message: WorkerIn, transfer?: Transferable[]): boolean => {
            if (!handle.live || this.worker !== worker) return false;
            worker.postMessage(message, transfer);
            return true;
        };
        if (!post({ type: 'load-begin', graph: id, shell, outline: outline ? outlineShell : null })) return;
        const fields: Array<[LoadField, readonly unknown[]]> = [['nodes', nodes], ['edges', edges], ['findings', findings], ['outlineFiles', files]];
        for (const [field, list] of fields) {
            for (let at = 0; at < list.length; at += SLICE) {
                if (!post({ type: 'load-chunk', graph: id, field, items: list.slice(at, at + SLICE) })) return;
                await macrotask();
            }
        }
        // Links are numbers: four per link in a typed array, which crosses by transfer.
        for (let at = 0; at < links.length; at += SLICE) {
            const flat = new Uint32Array(Math.min(SLICE, links.length - at) * 4);
            for (let i = 0; i < flat.length / 4; i++) flat.set(links[at + i]!, i * 4);
            if (!post({ type: 'load-chunk', graph: id, field: 'outlineLinks', items: flat }, [flat.buffer])) return;
            await macrotask();
        }
        post({ type: 'load-end', graph: id });
    }

    /** The worker died or never started: everything it owed is done in-process, and so is everything after. */
    private failOver(reason: unknown): void {
        this.warn(reason);
        this.worker?.terminate();
        this.worker = null;
        this.inProcess = true;
        this.loads.clear();
        const owed = [...this.pending.values()];
        this.pending.clear();
        for (const entry of owed) entry.rerun();
    }

    /** The idle worker is let go; a later user builds a new one (and the graphs are posted again). */
    private retire(): void {
        this.lingering = null;
        if (this.users > 0) return;
        this.worker?.terminate();
        this.worker = null;
        this.loads.clear();
        this.pending.clear();
    }

    private revive(): void {
        try {
            this.worker = this.spawn();
        } catch (error) {
            this.warn(error);
        }
        if (this.worker) this.attach(this.worker); else this.inProcess = true;
    }

    private warn(reason: unknown): void {
        if (this.warned) return;
        this.warned = true;
        console.warn('knowledge-graph-view: the compute worker is unavailable, computing on the main thread.', reason);
    }
}

/** The worker, in the form webpack 5 and Vite both bundle statically. Null where there is none (a server render, jsdom). */
export function spawnComputeWorker(): WorkerLike | null {
    if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
    return new Worker(new URL('./graphCompute.worker.ts', import.meta.url), { type: 'module', name: 'kg-compute' }) as unknown as WorkerLike;
}

let shared: ComputeClient | null = null;

/** The one client of the page, built on first use. */
export function getComputeClient(): ComputeClient {
    shared ??= new ComputeClient(spawnComputeWorker);
    return shared;
}

/** Replaces the shared client (tests hand in one with a fake worker); null forgets it. */
export function setComputeClient(client: ComputeClient | null): void {
    shared = client;
}
