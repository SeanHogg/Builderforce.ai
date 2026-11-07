/**
 * knowledge/replicaQueue.ts — the REPLICA's DIRTY SET (PRD 41 A11, replacing the A7 op log).
 *
 * A linked root keeps, per root, two small things: the server's last acknowledged `{generation, digest}`
 * and the set of KEYS changed since — `f:<path>` (a file), `a:<factKey>` (a fact), `r:<from>␀<to>␀<kind>`
 * (a relation). They are the manifest tree's leaf keys, so the fast path (send the dirty keys) and the
 * reconcile path (send what the manifest tree says differs) speak the same key space. A key never holds
 * a body: the pump reads the current body from the local store when it builds the pack, and a key whose
 * row no longer exists becomes a tombstone.
 *
 * Rules the file lives by (the review's I/O must never wait on it):
 *   - `markDirty` is synchronous and never throws; nothing awaits a save inside a file's step;
 *   - the file is saved at most once per `saveEveryMs` (default 1 s), and only when something changed;
 *   - the file is the dirty keys as one JSON array of short strings (an 18,838-file root is well under 1 MB);
 *   - a key is removed by `settle` only if it was not marked again after the pump read it.
 *
 * The queue BELONGS TO ONE PROJECT (`adopt` discards another project's dirty set and ack). No ack
 * (a first sync, a lost or unreadable file) means the next sync RECONCILES instead of trusting the set.
 * A file that does not parse is kept aside (`keepAside`), reported (`onCorrupt`) and treated as empty.
 * An op log written by an older version is converted to dirty keys on load (its keys only), then deleted
 * (`legacy.remove`).
 */

import { factLeafKey, fileLeafKey, relationLeafKey } from '@seanhogg/builderforce-memory/knowledge/pack';

/** The server's last acknowledged state for the root. */
export interface ReplicaAck { generation: number; digest: string }

/** An analysis snapshot waiting to ride the next pack (the one body with no other home). */
export interface ReplicaAnalysis { sha: string; snapshot: unknown }

/** Where the dirty set is kept: one JSON string. */
export interface ReplicaPersistence {
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
    /** Keeps an unreadable file for inspection before it is replaced. */
    keepAside?(text: string): Promise<void>;
    /** Deletes the file (an op log after its conversion). */
    remove?(): Promise<void>;
}

export interface ReplicaQueueOptions {
    /** A failed save or load is reported here, never thrown. */
    onError?(error: unknown): void;
    /** The saved file did not parse: it was kept aside and the set starts empty with no ack (the next sync reconciles). */
    onCorrupt?(): void;
    /** A save at most this often while keys keep arriving (default 1000 ms). */
    saveEveryMs?: number;
    /** Where an older version's op log lives: read once on load, converted to dirty keys, then removed. */
    legacy?: Pick<ReplicaPersistence, 'read' | 'remove'>;
}

/** What the pump read: the keys, which mark each was read at, and the ack and analysis at that moment. */
export interface DirtySnapshot {
    keys: string[];
    marks: ReadonlyMap<string, number>;
    ack?: ReplicaAck;
    analysis?: ReplicaAnalysis;
}

export interface ReplicaQueue {
    /** Marks keys changed. Synchronous, deduplicated, never throws. */
    markDirty(keys: Iterable<string>): void;
    /** Stores the analysis snapshot the next pack carries (the latest wins). */
    setAnalysis(analysis: ReplicaAnalysis): void;
    /** The dirty keys, the ack and the pending analysis, as of now. */
    snapshot(): Promise<DirtySnapshot>;
    /**
     * A pack carrying `sent` keys of `snapshot` was acknowledged as `ack`: those keys leave the set unless
     * they were marked again since, and the ack is stored. Pass `analysisSent` when the pack carried the analysis.
     */
    settle(snapshot: DirtySnapshot, ack: ReplicaAck, sent?: readonly string[], analysisSent?: boolean): Promise<void>;
    /** Number of dirty keys. */
    size(): Promise<number>;
    ack(): Promise<ReplicaAck | undefined>;
    /** Forgets the ack: the next sync reconciles (a first sync, a moved server, a lost set). */
    requestReconcile(): Promise<void>;
    /** The project this set is filled for; undefined until {@link adopt}. */
    projectId(): Promise<number | undefined>;
    /** Binds the set to `projectId`; one filled for another project is discarded. True when keys were. */
    adopt(projectId: number): Promise<boolean>;
    /** Drops everything. */
    clear(): Promise<void>;
    /** Makes the set durable now. */
    flush(): Promise<void>;
    /** Told after every change. */
    onChange(cb: () => void): () => void;
}

/** Dirty key of a source file. */
export const fileKey = fileLeafKey;
/** Dirty key of a stored fact. */
export const factKey = factLeafKey;
/** Dirty key of a stored relation (its upsert identity). */
export const relationKey = relationLeafKey;

/** A set that lives in memory only (an unlinked root, a portable pack's upload). */
export function memoryReplicaPersistence(): ReplicaPersistence {
    let text: string | undefined;
    return { read: async () => text, write: async (t) => { text = t; } };
}

interface Parsed { keys: string[]; projectId?: number; ack?: ReplicaAck; analysis?: ReplicaAnalysis; corrupt: boolean; legacy: boolean }

/** The keys an old op log owed: its fact and relation keys, and the files its stale marks named. */
function keysOfLegacyOps(ops: unknown[]): string[] {
    const keys: string[] = [];
    for (const raw of ops) {
        const op = raw as { op?: string; facts?: string[]; relations?: string[]; sourceRef?: string };
        if (op?.op === 'write') {
            for (const k of op.facts ?? []) keys.push(factKey(k));
            for (const k of op.relations ?? []) keys.push(`r:${k}`);
        } else if (op?.op === 'markStale' && typeof op.sourceRef === 'string') {
            const at = op.sourceRef.indexOf('::');
            if (at > 0) keys.push(fileKey(op.sourceRef.slice(at + 2), ''));
        }
    }
    return keys;
}

function parse(text: string | undefined): Parsed {
    if (!text) return { keys: [], corrupt: false, legacy: false };
    try {
        const p = JSON.parse(text) as { version?: number; dirty?: unknown; ops?: unknown; projectId?: unknown; ack?: unknown; analysis?: unknown } | null;
        if (!p || typeof p !== 'object') return { keys: [], corrupt: true, legacy: false };
        const projectId = typeof p.projectId === 'number' ? p.projectId : undefined;
        if (Array.isArray(p.ops)) return { keys: keysOfLegacyOps(p.ops), ...(projectId !== undefined ? { projectId } : {}), corrupt: false, legacy: true };
        if (!Array.isArray(p.dirty)) return { keys: [], corrupt: true, legacy: false };
        const a = p.ack as Partial<ReplicaAck> | undefined;
        const an = p.analysis as Partial<ReplicaAnalysis> | undefined;
        return {
            keys: (p.dirty as unknown[]).filter((k): k is string => typeof k === 'string'),
            ...(projectId !== undefined ? { projectId } : {}),
            ...(a && Number.isSafeInteger(a.generation) && typeof a.digest === 'string' ? { ack: { generation: a.generation!, digest: a.digest } } : {}),
            ...(an && typeof an.sha === 'string' ? { analysis: { sha: an.sha, snapshot: an.snapshot } } : {}),
            corrupt: false, legacy: false,
        };
    } catch {
        return { keys: [], corrupt: true, legacy: false };
    }
}

export function createReplicaQueue(persistence: ReplicaPersistence, opts: ReplicaQueueOptions = {}): ReplicaQueue {
    const saveEveryMs = opts.saveEveryMs ?? 1000;
    const dirty = new Map<string, number>();
    let seq = 0;
    let project: number | undefined;
    let ack: ReplicaAck | undefined;
    let analysis: ReplicaAnalysis | undefined;
    let loaded: Promise<void> | undefined;
    let isLoaded = false;
    /** Marks that arrived before the file was read. */
    const early: string[] = [];
    let changedSinceSave = false;
    let saving: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const listeners = new Set<() => void>();

    const changed = (): void => { for (const cb of [...listeners]) { try { cb(); } catch { /* a listener never breaks the set */ } } };
    const add = (keys: Iterable<string>): void => { for (const k of keys) dirty.set(k, ++seq); };

    const ready = (): Promise<void> => (loaded ??= (async () => {
        try {
            const text = await persistence.read();
            const parsed = parse(text);
            if (parsed.corrupt) {
                try { await persistence.keepAside?.(text ?? ''); } catch (error) { opts.onError?.(error); }
                opts.onError?.(new Error('replica dirty set file did not parse'));
                opts.onCorrupt?.();
            }
            let from = parsed;
            // An older version's op log, in its own file or ours: its keys only; the file goes.
            if (!text && opts.legacy) {
                try {
                    const old = parse(await opts.legacy.read());
                    if (old.legacy) { from = old; await opts.legacy.remove?.(); changedSinceSave = true; }
                } catch (error) { opts.onError?.(error); }
            } else if (parsed.legacy) changedSinceSave = true;
            add(from.keys);
            project ??= from.projectId;
            if (!from.legacy) { ack ??= from.ack; analysis ??= from.analysis; }
        } catch (error) {
            opts.onError?.(error);
        } finally {
            isLoaded = true;
            add(early.splice(0));
        }
    })());

    const save = (): Promise<void> => {
        if (timer) { clearTimeout(timer); timer = undefined; }
        if (!changedSinceSave) return saving;
        changedSinceSave = false;
        saving = saving.then(async () => {
            await ready(); // never write before the file was read: that would replace what it held
            await persistence.write(JSON.stringify({
                version: 2, ...(project !== undefined ? { projectId: project } : {}), ...(ack ? { ack } : {}),
                dirty: [...dirty.keys()], ...(analysis ? { analysis } : {}),
            }));
        }).catch((error: unknown) => { changedSinceSave = true; opts.onError?.(error); });
        return saving;
    };
    const touch = (): void => {
        changedSinceSave = true;
        changed();
        if (!timer) {
            timer = setTimeout(() => { timer = undefined; void save(); }, saveEveryMs);
            (timer as { unref?: () => void }).unref?.();
        }
    };

    return {
        markDirty(keys) {
            try {
                if (!isLoaded) { early.push(...keys); void ready(); } else add(keys);
                touch();
            } catch (error) { opts.onError?.(error); }
        },
        setAnalysis(next) { analysis = next; void ready(); touch(); },
        async snapshot() {
            await ready();
            return { keys: [...dirty.keys()], marks: new Map(dirty), ...(ack ? { ack } : {}), ...(analysis ? { analysis } : {}) };
        },
        async settle(snap, next, sent = snap.keys, analysisSent = false) {
            await ready();
            for (const k of sent) if (dirty.get(k) === snap.marks.get(k)) dirty.delete(k);
            if (analysisSent && analysis === snap.analysis) analysis = undefined;
            ack = next;
            touch();
        },
        async size() { await ready(); return dirty.size; },
        async ack() { await ready(); return ack; },
        async requestReconcile() { await ready(); if (ack) { ack = undefined; touch(); } },
        async projectId() { await ready(); return project; },
        async adopt(projectId) {
            await ready();
            if (project === projectId) return false;
            const discarded = project !== undefined && dirty.size > 0;
            if (project !== undefined) { dirty.clear(); ack = undefined; analysis = undefined; }
            project = projectId;
            touch();
            return discarded;
        },
        async clear() { await ready(); dirty.clear(); ack = undefined; analysis = undefined; touch(); },
        async flush() { await ready(); await save(); },
        onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    };
}
