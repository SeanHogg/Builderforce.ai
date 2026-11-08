/**
 * The compute client: how a component asks for a heavy computation without running it on the main thread.
 *
 * `run(kind, input, callbacks)` encodes the input (naming graph elements by index), asks the worker, and decodes the reply
 * back onto the caller's own objects. Superseded requests are cancelled and nothing is delivered after a cancel. The graph is
 * posted to the worker once, in slices (`loader.ts`), when a task first needs it.
 *
 * EDIT CONTRACT: GRAPHS ARE IMMUTABLE (see `residency.ts`). The worker's copy and every index the client sends are valid only
 * while the graph object and its arrays are unchanged; an edit hands the client a NEW graph, which is streamed afresh.
 *
 * NO REQUEST IS EVER DROPPED SILENTLY. A request that cannot complete where it was sent is settled one way or another:
 *  - its graph was evicted while it was in flight (MAX_RESIDENT): it is re-encoded (which holds the graph again) and re-run,
 *    a few times, then in-process;
 *  - the worker died, could not be cloned to (a DataCloneError on a post), sent a reply that cannot be read, or was let go
 *    while idle: everything it owed runs in-process (`failOver` for a worker that is broken for good, `retire` for one that
 *    is merely let go and may be revived).
 *
 * FALLBACK. With no `Worker` (jsdom, a server render), or when the worker cannot be built or dies (a host CSP that blocks
 * it), the same handlers run in-process through the idle-step scheduler: identical results, on the main thread, with ONE
 * `console.warn` that names the reason. Nothing else in the package knows which mode it is in.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { runIdleTask, type IdleTask } from '../useIdleSteps';
import { CODECS } from './codecs';
import type { KindInput, KindResult } from './kinds';
import { streamGraph, type Post } from './loader';
import type { GraphId, TaskKind, TaskTable, WorkerOut } from './protocol';
import { Residency } from './residency';
import { ComputeStore } from './store';
import { HANDLERS } from './tasks';
import type { Spawn, WorkerLike } from './workerFactory';

export type { Spawn, WorkerLike } from './workerFactory';

export interface Callbacks<R> { done(result: R): void; fail(error: unknown): void }

/** How long the worker is kept after its last user is gone (a remount in this window finds the graph still loaded). */
const KEEP_ALIVE_MS = 10_000;
/** How many times a request whose graph was evicted under it is sent again before it runs in-process. */
const MAX_RETRIES = 2;

/** A request in flight at the worker. */
interface Pending {
    graph: GraphId;
    posted: boolean;
    receive(raw: unknown): void;
    fail(error: unknown): void;
    /** Runs the same request in-process (the worker cannot). */
    rerun(): void;
    /** Encodes the request afresh and dispatches it again (its graph was evicted). */
    retry(): void;
}

/** What a dispatched request reports to its caller. */
interface Hooks { deliver(raw: unknown): void; fail(error: unknown): void; relaunch(): void }

const noop = (): void => undefined;
const handlerOf = (kind: TaskKind): ((store: ComputeStore, req: unknown) => IdleTask<unknown>) => HANDLERS[kind] as never;

export class ComputeClient {
    readonly residency = new Residency((id) => this.evict(id));
    private readonly local = new ComputeStore();
    private worker: WorkerLike | null = null;
    private inProcess = false;
    private warned = false;
    private users = 0;
    private lingering: ReturnType<typeof setTimeout> | null = null;
    private seq = 0;
    private readonly pending = new Map<number, Pending>();
    private readonly loads = new Map<GraphId, Promise<void>>();

    constructor(private readonly spawn: Spawn) {
        this.revive();
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
        const task = handlerOf(kind)(this.adopted(graph, this.residency.handleOf(graph)?.graph), req);
        while (!task.step());
        return CODECS[kind].decode(task.result() as never, input as never) as KindResult<K>;
    }

    /** Asks for a computation; returns the function that cancels it. At most one of the callbacks is called, and none after the cancel. */
    run<K extends TaskKind>(kind: K, input: KindInput<K>, callbacks: Callbacks<KindResult<K>>): () => void {
        let live = true;
        let stop = noop;
        const hooks: Hooks = {
            deliver: (raw) => {
                if (!live) return;
                try { callbacks.done(CODECS[kind].decode(raw as never, input as never) as KindResult<K>); } catch (error) { callbacks.fail(error); }
            },
            fail: (error) => { if (live) callbacks.fail(error); },
            relaunch: () => launch(attempt + 1),
        };
        let attempt = 0;
        const launch = (n: number): void => {
            if (!live) return;
            attempt = n;
            try {
                const { graph, req } = this.encode(kind, input);
                stop = this.dispatch(kind, graph, req, hooks, n);
            } catch (error) {
                hooks.fail(error);
            }
        };
        launch(0);
        return () => { live = false; stop(); };
    }

    /** Lets go of the worker and settles everything it owed in-process. For a client that is being replaced. */
    dispose(): void {
        if (this.lingering) { clearTimeout(this.lingering); this.lingering = null; }
        this.stopWorker();
        this.inProcess = true;
        this.drain();
    }

    private encode<K extends TaskKind>(kind: K, input: KindInput<K>): { graph: GraphId; req: TaskTable[K]['req'] } {
        return (CODECS[kind].encode as (i: KindInput<K>, r: Residency) => { graph: GraphId; req: TaskTable[K]['req'] })(input, this.residency);
    }

    /** Sends one encoded request to the worker, or runs it in-process. Returns its cancel. */
    private dispatch(kind: TaskKind, graph: GraphId, req: unknown, hooks: Hooks, attempt: number): () => void {
        let stopLocal = noop;
        // Captured now: a graph evicted before the idle callback runs is still the one this request's indices name.
        const source = this.residency.handleOf(graph)?.graph;
        const inProcess = (): void => {
            stopLocal = runIdleTask(() => handlerOf(kind)(this.adopted(graph, source), req), hooks.deliver, hooks.fail);
        };
        if (this.inProcess || !this.worker || attempt > MAX_RETRIES) { inProcess(); return () => stopLocal(); }
        const id = ++this.seq;
        const entry: Pending = { graph, posted: false, receive: hooks.deliver, fail: hooks.fail, rerun: inProcess, retry: hooks.relaunch };
        this.pending.set(id, entry);
        void this.ensureLoaded(graph).then(() => this.post(id, entry, kind, req));
        return () => {
            if (this.pending.delete(id) && entry.posted) this.send({ type: 'cancel', id });
            stopLocal();
        };
    }

    private post(id: number, entry: Pending, kind: TaskKind, req: unknown): void {
        if (this.pending.get(id) !== entry) return; // cancelled, answered, or already failed over
        if (!this.worker) { this.pending.delete(id); entry.rerun(); return; }
        if (!this.residency.isLive(entry.graph)) { this.pending.delete(id); this.settle(entry, entry.retry); return; }
        try {
            entry.posted = true;
            this.worker.postMessage({ type: 'run', id, graph: entry.graph, kind, req });
        } catch (error) {
            this.failOver(error); // a request that cannot be cloned cannot go to the worker: it, and everything owed, runs here
        }
    }

    /** Runs `action` for a request, failing the request if the action throws. */
    private settle(entry: Pending, action: () => void): void {
        try { action.call(entry); } catch (error) { entry.fail(error); }
    }

    /** The in-process store with `graph` in it (the main thread's own graph, not a copy). */
    private adopted(graph: GraphId, source: KnowledgeGraph | undefined): ComputeStore {
        if (!this.local.has(graph)) {
            const held = source ?? this.residency.handleOf(graph)?.graph;
            if (!held) throw new Error(`compute: graph ${graph} was dropped`);
            this.local.adopt(graph, held);
        }
        return this.local;
    }

    private evict(id: GraphId): void {
        this.local.drop(id);
        this.loads.delete(id);
        this.send({ type: 'drop', graph: id });
    }

    private send(message: Parameters<WorkerLike['postMessage']>[0]): void {
        try { this.worker?.postMessage(message); } catch { /* a broken worker is handled where the work is posted */ }
    }

    private attach(worker: WorkerLike): void {
        worker.onmessage = (event) => this.receive(event.data);
        worker.onerror = (event) => this.failOver(event);
        worker.onmessageerror = (event) => this.failOver(event);
    }

    private receive(message: WorkerOut): void {
        const entry = this.pending.get(message.id);
        if (!entry) return; // cancelled
        this.pending.delete(message.id);
        // The graph it was computed for was evicted meanwhile (its indices name an array nobody holds): send it again, never drop it.
        if (!this.residency.isLive(message.graph)) { this.settle(entry, entry.retry); return; }
        if (message.type === 'done') entry.receive(message.raw);
        else entry.fail(new Error(message.message));
    }

    /** The graph in the worker: posted once, in slices, and awaited by every task that needs it. A failed post fails the worker over. */
    private ensureLoaded(id: GraphId): Promise<void> {
        const kept = this.loads.get(id);
        if (kept) return kept;
        const handle = this.residency.handleOf(id);
        const worker = this.worker;
        if (!handle || !worker) return Promise.resolve();
        const post: Post = (message, transfer) => {
            if (!handle.live || this.worker !== worker) return false;
            worker.postMessage(message, transfer);
            return true;
        };
        const load: Promise<void> = streamGraph(handle, post).catch((error) => {
            // A rejected load is never kept (it would poison the graph); the worker that could not take it is let go.
            if (this.loads.get(id) === load) { this.loads.delete(id); this.failOver(error); }
        });
        this.loads.set(id, load);
        return load;
    }

    /** The worker is broken: everything it owed is done in-process, and so is everything after. */
    private failOver(reason: unknown): void {
        this.warn(reason);
        this.stopWorker();
        this.inProcess = true;
        this.drain();
    }

    /** The idle worker is let go; a later user builds a new one (and the graphs are posted again). What it owed runs in-process. */
    private retire(): void {
        this.lingering = null;
        if (this.users > 0) return;
        this.stopWorker();
        this.drain();
    }

    private stopWorker(): void {
        const worker = this.worker;
        this.worker = null;
        this.loads.clear();
        try { worker?.terminate(); } catch { /* already gone */ }
    }

    private drain(): void {
        const owed = [...this.pending.values()];
        this.pending.clear();
        for (const entry of owed) this.settle(entry, entry.rerun);
    }

    private revive(): void {
        try {
            this.worker = this.spawn();
            if (!this.worker) this.warn(new Error('this runtime has no Worker'));
        } catch (error) {
            this.worker = null;
            this.warn(error);
        }
        if (this.worker) this.attach(this.worker); else this.inProcess = true;
    }

    private warn(reason: unknown): void {
        if (this.warned) return;
        this.warned = true;
        const why = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : 'the worker failed';
        console.warn(`knowledge-graph-view: computing on the main thread (${why}). Large graphs may stall the page.`, reason);
    }
}
