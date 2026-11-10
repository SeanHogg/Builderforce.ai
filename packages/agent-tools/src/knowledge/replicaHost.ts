/**
 * knowledge/replicaHost.ts — the REPLICA HOST (PRD 41 A7, A11): one persisted dirty set and one pump per linked root, in
 * this host (an editor process, a browser tab). The review writes its local store and marks what changed for the linked
 * project (`replicatedKnowledgeStore`); this module owns what happens to the dirty set afterwards:
 *
 *   queue    `<root>.dirty.json` (keys, plus the server's last ack), written atomically (temp, then rename), bound to ONE
 *            project, shared by every opener of the root. An op log an older version left is converted on first load;
 *   pump     sends ONE pack when a review finishes, when the host opens with keys waiting, and, while files change, at most
 *            once every 60 s after a live edit marked one. It never sends while the root is being reviewed, only the host
 *            holding the root's lock pumps (`ReplicaLockPort`), and it is bound to the project of its client: a project
 *            switch aborts it, discards the other project's queue and starts a fresh pump with the new client;
 *   quiet    a HEALTHY linked root with nothing to send still starts a pump every `GENERATION_CHECK_INTERVAL_MS` (one unref'd
 *            timer per root, skipped while a pump or a review runs, cleared once the root no longer resolves to the project
 *            its queue is bound to). Failures and auth pauses are restarted by Retry upload and sign-in, never by this timer;
 *   state    kept per root in memory ({@link ReplicaState}) and read by the sync status.
 *
 * Nothing here can fail a review: the pump reports into the state, never into the caller. All state is per host instance.
 */

import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import type { KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeFiles } from './fileManifest.js';
import { analysisPendingFileName, dirtyFileName, replicaFileName } from './fileManifest.js';
import { currentSourcesOf, enqueueFirstSync } from './replicaFirstSync.js';
import { persistenceOf, readThroughOf, type ReplicaHostClient } from './replicaHostParts.js';
import { fileReplicaLock, type ReplicaLockPort } from './replicaLock.js';
import { GENERATION_CHECK_INTERVAL_MS, emptyReplicaState, pumpReplica, type ReplicaState } from './replicaPump.js';
import { createReplicaQueue, type ReplicaQueue } from './replicaQueue.js';
import { replicatedKnowledgeStore } from './replicatedStore.js';
import { sourcePathIn } from './rootId.js';

/** A live edit's mark waits this long for more (never during a review). */
const KICK_DEBOUNCE_MS = 1500;
/** While files change, a pack is sent at most this often; a review's end sends at once. */
export const MIN_SEND_INTERVAL_MS = 60_000;
/** A background pump gives up (paused: unreachable) after this many transient failures in a row, instead of retrying for ever. */
export const BACKGROUND_TRANSIENT_STREAK = 8;

/** Which project each root's local snapshot was first-synced to, set once the first sync has DRAINED. */
export interface UploadMarks {
    get(rootId: string): number | undefined;
    set(rootId: string, projectId: number): Promise<void>;
}

/** What a pump needs, read when it starts (the client and store may change with the linked project). */
export interface PumpSource {
    rootId: string;
    files: KnowledgeFiles;
    local: KnowledgeStore;
    client: ReplicaHostClient;
    /** The project `client` talks to. */
    projectId: number;
    /** The root's manifest: the current sources (path and content hash) the pack is built from. */
    manifest: IngestManifest;
    /** A source's size in bytes (root-relative path), from the directory source's stat cache; absent when unknown. */
    sizeOf?: (path: string) => number | undefined;
}

export interface ReplicaHostOptions {
    /** Who may pump a root: default is the file lock (`fileReplicaLock()`). */
    lock?: ReplicaLockPort;
    /** Where the host reports (silent until set, and in tests). */
    report?: (what: string, error: unknown) => void;
}

export interface ReplicaHost {
    configureReplicaLog(cb: (what: string, error: unknown) => void): void;
    replicaQueueFor(rootId: string, files: KnowledgeFiles): ReplicaQueue;
    replicaStatusOf(rootId: string, files: KnowledgeFiles): Promise<ReplicaState>;
    onReplicaState(cb: (rootId: string, state: ReplicaState) => void): () => void;
    replicatedStoreOf(
        rootId: string, files: KnowledgeFiles, local: KnowledgeStore, pump: PumpSource | undefined, readThrough: boolean,
        resolve?: () => PumpSource | undefined,
    ): KnowledgeStore;
    /** Holds the root as reviewing around `run`, then starts the pump (when one is given). */
    duringReview<T>(rootId: string, files: KnowledgeFiles, pump: PumpSource | undefined, run: () => Promise<T>): Promise<T>;
    setRootReviewing(rootId: string, files: KnowledgeFiles, active: boolean): void;
    isRootReviewing(rootId: string): boolean;
    replicaDrained(rootId: string): Promise<void>;
    /** Waits for the running pump at most `ms` (the timer is unref'd). */
    drainedWithin(rootId: string, ms: number): Promise<'drained' | 'pending'>;
    stopReplicaPump(rootId: string): Promise<void>;
    startReplicaPump(source: PumpSource, opts?: { probe?: boolean }): Promise<void>;
    retryReplica(source: PumpSource): void;
    resumeAuthPaused(): Promise<void>;
    kickReplicaPump(rootId: string, files: KnowledgeFiles, resolve: () => PumpSource | undefined): void;
    resumeReplica(source: PumpSource): Promise<void>;
    queueFirstSyncOnce(args: PumpSource & { manifest: IngestManifest; marks: UploadMarks }): Promise<boolean>;
    disposeReplicas(): Promise<void>;
}

interface Entry {
    queue: ReplicaQueue;
    state: ReplicaState;
    abort?: AbortController;
    running?: Promise<void>;
    /** The project of the running pump. */
    projectId?: number;
    reviewing: number;
    waiters: Array<() => void>;
    timer?: ReturnType<typeof setTimeout>;
    /** The quiet-root timer: starts a pump every `GENERATION_CHECK_INTERVAL_MS`. */
    quiet?: ReturnType<typeof setInterval>;
    /** The CURRENT pump source of the linked root (set by `replicatedStoreOf`): the timer never starts a stale one. */
    resolve?: () => PumpSource | undefined;
    /** The saved queue did not parse: the first sync is queued again whatever the marks say. */
    corrupt: boolean;
    /** Epoch ms the last pump started: live edits wait until `MIN_SEND_INTERVAL_MS` after it. */
    lastStartAt?: number;
    /** The last pump returned without sending because another host held the root's lock: nothing of ours has drained. */
    lockMissed?: boolean;
    /** The source of the last pump, so a sign-in can restart one that paused on auth. */
    lastSource?: PumpSource;
    /** Runs once the queue has drained for `projectId` (marks the first sync done). */
    pendingMark?: { projectId: number; run: () => Promise<void> };
}

export function createReplicaHost(opts: ReplicaHostOptions = {}): ReplicaHost {
    const lock = opts.lock ?? fileReplicaLock();
    let report: (what: string, error: unknown) => void = opts.report ?? (() => undefined);
    const entries = new Map<string, Entry>();
    const listeners = new Set<(rootId: string, state: ReplicaState) => void>();

    const entryOf = (rootId: string, files: KnowledgeFiles): Entry => {
        let held = entries.get(rootId);
        if (!held) {
            const made: Entry = {
                queue: createReplicaQueue(persistenceOf(files, dirtyFileName(rootId)), {
                    rootId,
                    legacy: persistenceOf(files, replicaFileName(rootId)),
                    analysis: persistenceOf(files, analysisPendingFileName(rootId)),
                    onError: (error) => report('replica queue', error),
                    onCorrupt: () => { made.corrupt = true; },
                }),
                state: emptyReplicaState(), reviewing: 0, waiters: [], corrupt: false,
            };
            entries.set(rootId, made);
            held = made;
        }
        return held;
    };

    const notify = (rootId: string, state: ReplicaState): void => {
        for (const cb of [...listeners]) { try { cb(rootId, state); } catch { /* a listener never stops the pump */ } }
    };

    /** Resolves when no review of the root is running, or the pump is stopped. */
    const waitNotReviewing = (held: Entry, signal: AbortSignal): Promise<void> => {
        if (held.reviewing === 0 || signal.aborted) return Promise.resolve();
        return new Promise((resolve) => {
            const done = (): void => { signal.removeEventListener('abort', done); resolve(); };
            held.waiters.push(done);
            signal.addEventListener('abort', done, { once: true });
        });
    };

    const clearTimers = (held: Entry): void => {
        if (held.timer) { clearTimeout(held.timer); held.timer = undefined; }
        if (held.quiet) { clearInterval(held.quiet); held.quiet = undefined; }
    };

    const host: ReplicaHost = {
        configureReplicaLog(cb) { report = cb; },

        replicaQueueFor: (rootId, files) => entryOf(rootId, files).queue,

        async replicaStatusOf(rootId, files) {
            const held = entryOf(rootId, files);
            return { ...held.state, failed: [...held.state.failed], dirty: await held.queue.size() };
        },

        onReplicaState(cb) {
            listeners.add(cb);
            return () => { listeners.delete(cb); };
        },

        replicatedStoreOf(rootId, files, local, pump, readThrough, resolve = () => pump) {
            if (pump) entryOf(rootId, files).resolve = resolve;
            return replicatedKnowledgeStore({
                local,
                rootId,
                queue: host.replicaQueueFor(rootId, files),
                ...(pump ? {
                    // What the last local review held: a file is marked dirty only when its hash differs from it.
                    knownHashes: async () => new Map((await currentSourcesOf(pump.manifest, rootId)).map((s) => [s.ref, s.hash] as const)),
                    replica: { projectId: pump.projectId, ...(readThrough ? { readThrough: readThroughOf(pump.client, rootId) } : {}) },
                    onQueued: () => host.kickReplicaPump(rootId, files, resolve),
                } : {}),
                onError: (error) => report('replica', error),
            });
        },

        async duringReview(rootId, files, pump, run) {
            host.setRootReviewing(rootId, files, true);
            try {
                return await run();
            } finally {
                host.setRootReviewing(rootId, files, false);
                if (pump) void host.startReplicaPump(pump);
            }
        },

        setRootReviewing(rootId, files, active) {
            const held = entryOf(rootId, files);
            held.reviewing = Math.max(0, held.reviewing + (active ? 1 : -1));
            if (held.reviewing === 0) for (const wake of held.waiters.splice(0)) wake();
        },

        isRootReviewing: (rootId) => (entries.get(rootId)?.reviewing ?? 0) > 0,

        replicaDrained: (rootId) => entries.get(rootId)?.running ?? Promise.resolve(),

        async drainedWithin(rootId, ms) {
            const running = entries.get(rootId)?.running;
            if (!running) return entries.get(rootId)?.lockMissed ? 'pending' : 'drained';
            let timer: ReturnType<typeof setTimeout> | undefined;
            const late = new Promise<'pending'>((resolve) => {
                timer = setTimeout(() => resolve('pending'), ms);
                (timer as { unref?: () => void }).unref?.();
            });
            try {
                // A pump that returned because another tab held the lock sent nothing: that is not "drained".
                return await Promise.race([running.then(() => (entries.get(rootId)?.lockMissed ? 'pending' as const : 'drained' as const)), late]);
            } finally {
                if (timer) clearTimeout(timer);
            }
        },

        async stopReplicaPump(rootId) {
            const held = entries.get(rootId);
            if (!held) return;
            clearTimers(held);
            held.abort?.abort();
            await held.running;
        },

        async startReplicaPump(source, startOpts = {}) {
            const held = entryOf(source.rootId, source.files);
            if (held.running) {
                if (held.projectId === source.projectId) return held.running;
                await host.stopReplicaPump(source.rootId);
            }
            const abort = new AbortController();
            held.abort = abort;
            held.projectId = source.projectId;
            held.lastSource = source;
            if (!startOpts.probe) held.lastStartAt = Date.now(); // only real sends delay a live edit's pump
            armQuietCheck(held);
            const running: Promise<void> = (async () => {
                // Only the host holding the lock pumps: another host's pump on this root is not ours to double.
                const held2 = await lock.acquire(source.files, source.rootId).catch(() => undefined);
                held.lockMissed = !held2;
                if (!held2) return;
                // Lost to another host after a stall (its refresh found another owner's stamp): stop pumping its queue at once.
                const onLost = (): void => {
                    held.lockMissed = true;
                    report('replica lock', new Error(`the replica lock of ${source.rootId} was taken by another host; this host stopped pumping`));
                    abort.abort();
                };
                held2.lost?.addEventListener('abort', onLost, { once: true });
                try {
                    // Another tab sharing the queue file may have advanced its ack since this one loaded: start from the file, never a stale view.
                    await held.queue.reload().catch((error) => report('replica queue reload', error));
                    const state = await pumpReplica({
                        queue: held.queue, local: source.local, client: source.client, signal: abort.signal, initial: held.state,
                        projectId: source.projectId, rootId: source.rootId, maxTransientStreak: BACKGROUND_TRANSIENT_STREAK,
                        ...(held2.isFresh ? { lockHeld: () => held2.isFresh!() } : {}),
                        sources: async () => (await currentSourcesOf(source.manifest, source.rootId)).map((s) => {
                            const bytes = source.sizeOf?.(sourcePathIn(s.ref, source.rootId));
                            return bytes === undefined ? s : { ...s, bytes };
                        }),
                        idle: (signal) => waitNotReviewing(held, signal),
                        onState: (next) => { held.state = next; notify(source.rootId, next); },
                    });
                    const mark = held.pendingMark;
                    if (mark && mark.projectId === source.projectId && !abort.signal.aborted && state.dirty === 0 && !state.paused && state.failed.length === 0) {
                        held.pendingMark = undefined;
                        await mark.run();
                    }
                } catch (error) {
                    report('replica pump', error);
                } finally {
                    held2.lost?.removeEventListener('abort', onLost);
                    await held2.release();
                }
            })().finally(() => {
                if (held.abort === abort) { held.running = undefined; held.abort = undefined; }
            });
            held.running = running;
            return running;
        },

        retryReplica(source) {
            const held = entryOf(source.rootId, source.files);
            if (held.timer) { clearTimeout(held.timer); held.timer = undefined; }
            if (!held.running) {
                const { paused: _paused, pausedStatus: _pausedStatus, waitingUntil: _waitingUntil, waitingFor: _waitingFor, ...rest } = held.state;
                held.state = { ...rest, failed: [] };
                notify(source.rootId, held.state);
            }
            void host.startReplicaPump(source);
        },

        async resumeAuthPaused() {
            await Promise.all([...entries.values()]
                .filter((e) => e.state.paused === 'auth' && e.lastSource && !e.running)
                .map((e) => host.startReplicaPump(e.lastSource!)));
        },

        kickReplicaPump(rootId, files, resolve) {
            const held = entryOf(rootId, files);
            if (held.timer) clearTimeout(held.timer);
            const wait = Math.max(KICK_DEBOUNCE_MS, (held.lastStartAt ?? 0) + MIN_SEND_INTERVAL_MS - Date.now());
            held.timer = setTimeout(() => {
                held.timer = undefined;
                if (held.reviewing > 0) return;
                // Resolved NOW: the project may have changed since the key was marked. After shutdown the store refuses to open
                // (`knowledge_shutting_down`): that is reported, never thrown out of a timer.
                let source: PumpSource | undefined;
                try {
                    source = resolve();
                } catch (error) {
                    report('replica pump', error);
                    return;
                }
                if (source) void host.startReplicaPump(source);
            }, wait);
        },

        async resumeReplica(source) {
            const queue = entryOf(source.rootId, source.files).queue;
            if ((await queue.projectId()) !== source.projectId) return;
            // A queue bound to this project always gets a pump on open: keys to send, an ack to check, or a reconcile owed.
            void host.startReplicaPump(source);
        },

        async queueFirstSyncOnce(args) {
            const { rootId, marks, projectId } = args;
            const held = entryOf(rootId, args.files);
            if (held.running && held.projectId !== projectId) await host.stopReplicaPump(rootId);
            await held.queue.size(); // loads the file, so a corrupt one is known
            const rebuild = held.corrupt;
            held.corrupt = false;
            await held.queue.adopt(projectId);
            if (!rebuild && marks.get(rootId) === projectId) return false;
            const counts = await enqueueFirstSync({ rootId, local: args.local, manifest: args.manifest, queue: held.queue });
            if (!counts) return false;
            await held.queue.flush();
            held.pendingMark = { projectId, run: () => marks.set(rootId, projectId) };
            void host.startReplicaPump(args);
            return true;
        },

        async disposeReplicas() {
            const all = [...entries.values()];
            await Promise.all(all.map((e) => e.queue.flush().catch(() => undefined)));
            for (const held of all) { clearTimers(held); held.abort?.abort(); }
            await Promise.all(all.map((e) => e.running));
            await Promise.all(all.map((e) => e.queue.flush().catch(() => undefined)));
            entries.clear();
            listeners.clear();
        },
    };

    /** One timer per linked root: every `GENERATION_CHECK_INTERVAL_MS` it starts a pump unless one or a review is running. */
    function armQuietCheck(held: Entry): void {
        if (held.quiet) return;
        held.quiet = setInterval(() => { void quietTick(held).catch((error) => report('replica quiet check', error)); }, GENERATION_CHECK_INTERVAL_MS);
        (held.quiet as { unref?: () => void }).unref?.();
    }

    async function quietTick(held: Entry): Promise<void> {
        if (held.running || held.reviewing > 0) return;
        const source = (held.resolve ?? (() => held.lastSource))();
        if (!source || (await held.queue.projectId()) !== source.projectId) {
            // Unlinked, the folder left the workspace, or the queue moved to another project: nothing here to check any more.
            if (held.quiet) { clearInterval(held.quiet); held.quiet = undefined; }
            return;
        }
        // Only a quiet, healthy root: a failed one waits for Retry upload, an auth-paused one for sign-in (unreachable may recover by itself).
        const owes = (await held.queue.size()) > 0;
        // A queue with keys waiting whose last pump missed the lock (another tab held it) is retried: nobody else may be sending it now.
        if ((owes && !held.lockMissed) || held.state.failed.length > 0 || (held.state.paused !== undefined && held.state.paused !== 'unreachable')) return;
        if (owes) { void host.startReplicaPump(source); return; }
        const { generationCheckedAt: _checked, ...rest } = held.state;
        held.state = rest; // forget the last check, so this pump really asks the server
        void host.startReplicaPump(source, { probe: true });
    }

    return host;
}
