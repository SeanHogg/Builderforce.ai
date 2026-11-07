/**
 * knowledge/replicaQueue.ts — the REPLICA QUEUE (PRD 41 A7): the ordered, serializable log of what a
 * linked root still owes its project. The local store is the source of truth for drawing; this log is
 * only "what to send", so it holds KEYS and HASHES and never a second copy of a body the local store
 * already has (the pump reads the body from the local store when it sends):
 *
 *   write         up to {@link REPLICA_WRITE_ROWS} fact keys and relation keys of one root — one op is one
 *                 request; a later write of the same rows supersedes the earlier copy (coalescing stays
 *                 inside a chunk, and progress is per chunk)
 *   scope         the root's scope record, its OWN final op: it is written after every row, so a failed
 *                 chunk can never leave a digest behind and a chunk can never carry the scope away
 *   putExtracted  a content hash (the Extracted output is read from the local store)
 *   markStale     a source ref and its current hash
 *   putAnalysis   an analysis snapshot — the one body with no other home, so it rides in the op
 *
 * The queue BELONGS TO ONE PROJECT (`projectId` is saved with it): {@link ReplicaQueue.adopt} discards a
 * queue that was filled for another project. It persists through a small port (`{ read, write }` of one
 * JSON string; in an editor `.builderforce/knowledge/<root>.replica.json`, written atomically by the
 * host). A save re-reads the file and merges the ops another window added, by identity. A file that does
 * not parse is kept aside (`keepAside`), reported (`onCorrupt`), and treated as empty. Saves are
 * throttled while a review writes and made durable by {@link ReplicaQueue.flush}; a persistence failure
 * is reported to `onError` and never reaches the caller.
 */

import type { NodeRef, ScopeRecord, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';

/** Rows (facts + relations) one write op carries — the platform's bound per request. */
export const REPLICA_WRITE_ROWS = 500;

export type ReplicaOp =
    | { op: 'write'; rootId: string; facts: string[]; relations: string[] }
    | { op: 'scope'; scope: ScopeRecord }
    | { op: 'putExtracted'; hash: string }
    | { op: 'markStale'; rootId: string; sourceRef: string; hash: string }
    | { op: 'putAnalysis'; sha: string; snapshot: unknown };

/** Where the queue is kept: the whole log as one JSON string. */
export interface ReplicaPersistence {
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
    /** Keeps an unreadable file for inspection before it is replaced. */
    keepAside?(text: string): Promise<void>;
}

export interface ReplicaQueueOptions {
    /** A failed save or load is reported here, never thrown. */
    onError?(error: unknown): void;
    /** The saved log did not parse: it was kept aside and the queue starts empty (the host re-queues the first sync). */
    onCorrupt?(): void;
    /** A save at most this often while ops keep arriving (default 2000 ms). */
    saveEveryMs?: number;
}

export interface ReplicaQueue {
    /** Appends an op (replacing an earlier op of the same identity). Never throws. */
    enqueue(op: Exclude<ReplicaOp, { op: 'write' | 'scope' }>): Promise<void>;
    /** Queues rows as chunks of at most {@link REPLICA_WRITE_ROWS}, then the scope as the final op. */
    enqueueWrite(args: { rootId: string; scope: ScopeRecord; facts: readonly string[]; relations: readonly string[] }): Promise<void>;
    /** The first `n` ops, oldest first, left in the queue. */
    peek(n: number): Promise<ReplicaOp[]>;
    /** Removes ops (the objects {@link peek} returned) once they are sent, skipped or failed. */
    remove(done: readonly ReplicaOp[]): Promise<void>;
    /** Puts `parts` where `op` was (a write split after a 413). */
    replace(op: ReplicaOp, parts: readonly ReplicaOp[]): Promise<void>;
    size(): Promise<number>;
    /** The project this queue is filled for; undefined until {@link adopt}. */
    projectId(): Promise<number | undefined>;
    /** Binds the queue to `projectId`; ops queued for another project are discarded. True when some were. */
    adopt(projectId: number): Promise<boolean>;
    /** Drops everything. */
    clear(): Promise<void>;
    /** Makes the log durable now. */
    flush(): Promise<void>;
    /** Told after every change in the queue's content. */
    onChange(cb: () => void): () => void;
}

/** A relation's key in an op: its upsert identity on the platform. */
export const relationKey = (r: Pick<StoredRelation, 'from' | 'to' | 'kind'>): string => `${r.from}\u0000${r.to}\u0000${r.kind}`;

const identity = (op: ReplicaOp): string => {
    switch (op.op) {
        case 'write': return `w:${op.rootId}:${op.facts[0] ?? ''}:${op.relations[0] ?? ''}:${op.facts.length + op.relations.length}`;
        case 'scope': return `c:${op.scope.rootId}`;
        case 'putExtracted': return `x:${op.hash}`;
        case 'markStale': return `s:${op.sourceRef as NodeRef}`;
        case 'putAnalysis': return `a:${op.sha}`;
    }
};

/** A queue that lives in memory only (an unlinked root has nothing to replicate). */
export function memoryReplicaPersistence(): ReplicaPersistence {
    let text: string | undefined;
    return { read: async () => text, write: async (t) => { text = t; } };
}

interface Parsed { ops: ReplicaOp[]; projectId?: number; corrupt: boolean }

function parse(text: string | undefined): Parsed {
    if (!text) return { ops: [], corrupt: false };
    try {
        const parsed = JSON.parse(text) as { ops?: unknown; projectId?: unknown } | null;
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.ops)) return { ops: [], corrupt: true };
        return {
            ops: (parsed.ops as ReplicaOp[]).filter((o) => o && typeof o === 'object' && 'op' in o),
            ...(typeof parsed.projectId === 'number' ? { projectId: parsed.projectId } : {}),
            corrupt: false,
        };
    } catch {
        return { ops: [], corrupt: true };
    }
}

export function createReplicaQueue(persistence: ReplicaPersistence, opts: ReplicaQueueOptions = {}): ReplicaQueue {
    const saveEveryMs = opts.saveEveryMs ?? 2000;
    let ops: ReplicaOp[] = [];
    let project: number | undefined;
    let loaded: Promise<void> | undefined;
    let dirty = false;
    let saving: Promise<void> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Identities this process removed since its last save: a merge with the file must not bring them back. */
    const retired = new Set<string>();
    const listeners = new Set<() => void>();

    const ready = (): Promise<void> => (loaded ??= persistence.read().then(
        async (text) => {
            const parsed = parse(text);
            if (parsed.corrupt) {
                try { await persistence.keepAside?.(text ?? ''); } catch (error) { opts.onError?.(error); }
                opts.onError?.(new Error('replica queue file did not parse'));
                opts.onCorrupt?.();
            }
            ops = [...parsed.ops, ...ops];
            project ??= parsed.projectId;
        },
        (error: unknown) => { opts.onError?.(error); },
    ));
    const changed = (): void => { for (const cb of [...listeners]) { try { cb(); } catch { /* a listener never breaks the queue */ } } };
    const retire = (op: ReplicaOp): void => { retired.add(identity(op)); };

    /** The file's ops that another window added (same project, not retired here, not already held). */
    const fromDisk = async (): Promise<ReplicaOp[]> => {
        try {
            const disk = parse(await persistence.read());
            if (disk.corrupt || disk.projectId !== project) return [];
            const held = new Set(ops.map(identity));
            return disk.ops.filter((o) => !retired.has(identity(o)) && !held.has(identity(o)));
        } catch {
            return [];
        }
    };

    const save = (): Promise<void> => {
        if (timer) { clearTimeout(timer); timer = undefined; }
        if (!dirty) return saving;
        dirty = false;
        saving = saving.then(async () => {
            ops = [...(await fromDisk()), ...ops];
            await persistence.write(JSON.stringify({ version: 1, ...(project !== undefined ? { projectId: project } : {}), ops }));
            retired.clear();
        }).catch((error: unknown) => { dirty = true; opts.onError?.(error); });
        return saving;
    };
    const touch = (): void => {
        dirty = true;
        changed();
        if (!timer) {
            timer = setTimeout(() => { timer = undefined; void save(); }, saveEveryMs);
            (timer as { unref?: () => void }).unref?.();
        }
    };

    return {
        async enqueue(op) {
            await ready();
            const key = identity(op);
            const at = ops.findIndex((o) => identity(o) === key);
            if (at >= 0) { retire(ops[at]!); ops.splice(at, 1); }
            ops.push(op);
            touch();
        },
        async enqueueWrite({ rootId, scope, facts, relations }) {
            await ready();
            if (facts.length + relations.length > 0) {
                const f = new Set(facts), r = new Set(relations);
                // The new copy of a row supersedes the queued one.
                for (let i = ops.length - 1; i >= 0; i--) {
                    const o = ops[i]!;
                    if (o.op !== 'write' || o.rootId !== rootId) continue;
                    const keptF = o.facts.filter((k) => !f.has(k)), keptR = o.relations.filter((k) => !r.has(k));
                    if (keptF.length === o.facts.length && keptR.length === o.relations.length) continue;
                    retire(o);
                    if (keptF.length + keptR.length === 0) ops.splice(i, 1); else ops[i] = { ...o, facts: keptF, relations: keptR };
                }
            }
            const scopeAt = ops.findIndex((o) => o.op === 'scope' && o.scope.rootId === rootId);
            if (scopeAt >= 0) { retire(ops[scopeAt]!); ops.splice(scopeAt, 1); }
            const rows = [...facts.map((k) => ({ fact: true, k })), ...relations.map((k) => ({ fact: false, k }))];
            let tail = -1;
            for (let i = ops.length - 1; i >= 0; i--) { const o = ops[i]!; if (o.op === 'write' && o.rootId === rootId) { tail = i; break; } }
            let next = 0;
            if (tail >= 0) {
                const o = ops[tail] as Extract<ReplicaOp, { op: 'write' }>;
                const room = REPLICA_WRITE_ROWS - o.facts.length - o.relations.length;
                if (room > 0 && rows.length > 0) {
                    const take = rows.slice(0, room);
                    retire(o);
                    ops[tail] = { ...o, facts: [...o.facts, ...take.filter((x) => x.fact).map((x) => x.k)], relations: [...o.relations, ...take.filter((x) => !x.fact).map((x) => x.k)] };
                    next = take.length;
                }
            }
            for (; next < rows.length; next += REPLICA_WRITE_ROWS) {
                const part = rows.slice(next, next + REPLICA_WRITE_ROWS);
                ops.push({ op: 'write', rootId, facts: part.filter((x) => x.fact).map((x) => x.k), relations: part.filter((x) => !x.fact).map((x) => x.k) });
            }
            ops.push({ op: 'scope', scope });
            touch();
        },
        async peek(n) { await ready(); return ops.slice(0, n); },
        async remove(done) {
            await ready();
            const gone = new Set(done);
            const before = ops.length;
            for (const o of ops) if (gone.has(o)) retire(o);
            ops = ops.filter((o) => !gone.has(o));
            if (ops.length !== before) touch();
        },
        async replace(op, parts) {
            await ready();
            const at = ops.indexOf(op);
            if (at < 0) return;
            retire(op);
            ops.splice(at, 1, ...parts);
            touch();
        },
        async size() { await ready(); return ops.length; },
        async projectId() { await ready(); return project; },
        async adopt(projectId) {
            await ready();
            if (project === projectId) return false;
            const discarded = project !== undefined && ops.length > 0;
            if (project !== undefined) { for (const o of ops) retire(o); ops = []; }
            project = projectId;
            touch();
            return discarded;
        },
        async clear() { await ready(); for (const o of ops) retire(o); ops = []; touch(); },
        async flush() { await ready(); await save(); },
        onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    };
}
