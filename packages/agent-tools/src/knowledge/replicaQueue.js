/**
 * knowledge/replicaQueue.ts — the REPLICA's DIRTY SET (PRD 41 A11, replacing the A7 op log).
 *
 * A linked root keeps, per root, two small things: the server's last acknowledged `{generation, digest}`
 * and the set of KEYS changed since — `f:<path>` (a file), `a:<factKey>` (a fact), `r:<from>␀<to>␀<kind>`
 * (a relation). They are the manifest tree's leaf keys, so the fast path (send the dirty keys) and the
 * reconcile path (send what the manifest tree says differs) speak the same key space. A key never holds
 * a body: the pump reads the current body from the local store when it builds the pack, and a key whose
 * row no longer exists becomes a tombstone. The dirty set is the ONLY source of deletions: a leaf the server holds
 * and this store merely lacks (another host's) is never deleted, however complete this store's review of the root.
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
import { splitSourceRef } from '@seanhogg/builderforce-memory/knowledge';
import { factLeafKey, fileLeafKey, relationLeafKey } from '@seanhogg/builderforce-memory/knowledge/pack';
/** The root a queue file belongs to (file names are hashed and cannot be inverted), or undefined for a file that predates the field or does not parse. */
export function queuedRootIdOf(text) {
    try {
        const id = JSON.parse(text)?.rootId;
        return typeof id === 'string' && id !== '' ? id : undefined;
    }
    catch {
        return undefined;
    }
}
/** Dirty key of a source file. */
export const fileKey = fileLeafKey;
/** Dirty key of a stored fact. */
export const factKey = factLeafKey;
/** Dirty key of a stored relation (its upsert identity). */
export const relationKey = relationLeafKey;
/** A set that lives in memory only (an unlinked root, a portable pack's upload). */
export function memoryReplicaPersistence() {
    let text;
    return { read: async () => text, write: async (t) => { text = t; } };
}
/**
 * The path an old stale mark named: a `src:` ref through THE parser (a root id ending in ':' included); an older ref without
 * the `src:` prefix keeps the old reading (everything after its first `::`); a string with neither names no file.
 */
function legacyStalePath(sourceRef) {
    if (sourceRef.startsWith('src:'))
        return splitSourceRef(sourceRef)?.path;
    const at = sourceRef.indexOf('::');
    return at > 0 ? sourceRef.slice(at + 2) : undefined;
}
/** The keys an old op log owed: its fact and relation keys, and the files its stale marks named. */
function keysOfLegacyOps(ops) {
    const keys = [];
    for (const raw of ops) {
        const op = raw;
        if (op?.op === 'write') {
            for (const k of op.facts ?? [])
                keys.push(factKey(k));
            for (const k of op.relations ?? [])
                keys.push(`r:${k}`);
        }
        else if (op?.op === 'markStale' && typeof op.sourceRef === 'string') {
            const path = legacyStalePath(op.sourceRef);
            if (path !== undefined)
                keys.push(fileKey(path, ''));
        }
    }
    return keys;
}
function parse(text) {
    if (!text)
        return { keys: [], corrupt: false, legacy: false };
    try {
        // An older file may still carry `additive: true` (a per-root flag since retired): it is ignored, and dropped on the next save.
        const p = JSON.parse(text);
        if (!p || typeof p !== 'object')
            return { keys: [], corrupt: true, legacy: false };
        const projectId = typeof p.projectId === 'number' ? p.projectId : undefined;
        if (Array.isArray(p.ops))
            return { keys: keysOfLegacyOps(p.ops), ...(projectId !== undefined ? { projectId } : {}), corrupt: false, legacy: true };
        if (!Array.isArray(p.dirty))
            return { keys: [], corrupt: true, legacy: false };
        const a = p.ack;
        const an = p.analysis;
        return {
            keys: p.dirty.filter((k) => typeof k === 'string'),
            ...(projectId !== undefined ? { projectId } : {}),
            ...(a && Number.isSafeInteger(a.generation) && typeof a.digest === 'string' ? { ack: { generation: a.generation, digest: a.digest } } : {}),
            ...(an && typeof an.sha === 'string' ? { analysis: { sha: an.sha, snapshot: an.snapshot } } : {}),
            corrupt: false, legacy: false,
        };
    }
    catch {
        return { keys: [], corrupt: true, legacy: false };
    }
}
export function createReplicaQueue(persistence, opts = {}) {
    const saveEveryMs = opts.saveEveryMs ?? 1000;
    const dirty = new Map();
    let seq = 0;
    let project;
    let ack;
    let analysis;
    /** The analysis changed since it was last written to its own file. */
    let analysisChanged = false;
    let loaded;
    let isLoaded = false;
    /** Marks that arrived before the file was read. */
    const early = [];
    let changedSinceSave = false;
    /** Counts saves begun: a reload whose read raced a save treats this queue as holding unsaved work. */
    let savesBegun = 0;
    let saving = Promise.resolve();
    let timer;
    const listeners = new Set();
    const changed = () => { for (const cb of [...listeners]) {
        try {
            cb();
        }
        catch { /* a listener never breaks the set */ }
    } };
    const add = (keys) => { for (const k of keys)
        dirty.set(k, ++seq); };
    const ready = () => (loaded ??= (async () => {
        try {
            const text = await persistence.read();
            const parsed = parse(text);
            if (parsed.corrupt) {
                try {
                    await persistence.keepAside?.(text ?? '');
                }
                catch (error) {
                    opts.onError?.(error);
                }
                opts.onError?.(new Error('replica dirty set file did not parse'));
                opts.onCorrupt?.();
            }
            let from = parsed;
            // An older version's op log, in its own file or ours: its keys only; the file goes.
            if (!text && opts.legacy) {
                try {
                    const old = parse(await opts.legacy.read());
                    if (old.legacy) {
                        from = old;
                        await opts.legacy.remove?.();
                        changedSinceSave = true;
                    }
                }
                catch (error) {
                    opts.onError?.(error);
                }
            }
            else if (parsed.legacy)
                changedSinceSave = true;
            add(from.keys);
            project ??= from.projectId;
            if (!from.legacy) {
                ack ??= from.ack;
                if (from.analysis) {
                    analysis ??= from.analysis;
                    if (opts.analysis)
                        analysisChanged = true;
                } // moved out of the dirty file on the next save
            }
            if (opts.analysis) {
                try {
                    const text = await opts.analysis.read();
                    const own = text ? JSON.parse(text) : undefined;
                    if (own && typeof own.sha === 'string')
                        analysis ??= { sha: own.sha, snapshot: own.snapshot };
                }
                catch (error) {
                    opts.onError?.(error);
                }
            }
        }
        catch (error) {
            opts.onError?.(error);
        }
        finally {
            isLoaded = true;
            add(early.splice(0));
        }
    })());
    const save = () => {
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }
        if (!changedSinceSave)
            return saving;
        changedSinceSave = false;
        savesBegun += 1;
        saving = saving.then(async () => {
            await ready(); // never write before the file was read: that would replace what it held
            await persistence.write(JSON.stringify({
                version: 2, ...(opts.rootId ? { rootId: opts.rootId } : {}), ...(project !== undefined ? { projectId: project } : {}), ...(ack ? { ack } : {}),
                dirty: [...dirty.keys()], ...(analysis && !opts.analysis ? { analysis } : {}),
            }));
            if (opts.analysis && analysisChanged) {
                analysisChanged = false;
                if (analysis)
                    await opts.analysis.write(JSON.stringify(analysis));
                else
                    await opts.analysis.remove?.();
            }
        }).catch((error) => { changedSinceSave = true; opts.onError?.(error); });
        return saving;
    };
    const touch = () => {
        changedSinceSave = true;
        changed();
        if (!timer) {
            timer = setTimeout(() => { timer = undefined; void save(); }, saveEveryMs);
            timer.unref?.();
        }
    };
    return {
        markDirty(keys) {
            try {
                if (!isLoaded) {
                    early.push(...keys);
                    void ready();
                }
                else
                    add(keys);
                touch();
            }
            catch (error) {
                opts.onError?.(error);
            }
        },
        async replaceDirty(keys, since) {
            await ready();
            // Keys marked AFTER `since` was read are newer work than the reconcile saw: they stay.
            for (const k of [...dirty.keys()])
                if (!since || dirty.get(k) === since.marks.get(k))
                    dirty.delete(k);
            add(keys);
            touch();
        },
        clearAnalysis() { if (analysis) {
            analysis = undefined;
            analysisChanged = true;
            touch();
        } },
        setAnalysis(next) { analysis = next; analysisChanged = true; void ready(); touch(); },
        async snapshot() {
            await ready();
            return { keys: [...dirty.keys()], marks: new Map(dirty), ...(ack ? { ack } : {}), ...(analysis ? { analysis } : {}) };
        },
        async settle(snap, next, sent = snap.keys, analysisSent = false, reconcile = false) {
            await ready();
            for (const k of sent)
                if (dirty.get(k) === snap.marks.get(k))
                    dirty.delete(k);
            if (analysisSent && analysis === snap.analysis) {
                analysis = undefined;
                analysisChanged = true;
            }
            ack = reconcile ? undefined : next;
            touch();
        },
        async size() { await ready(); return dirty.size; },
        async ack() { await ready(); return ack; },
        async requestReconcile() { await ready(); if (ack) {
            ack = undefined;
            touch();
        } },
        async projectId() { await ready(); return project; },
        async adopt(projectId) {
            await ready();
            if (project === projectId)
                return false;
            const discarded = project !== undefined && dirty.size > 0;
            if (project !== undefined) {
                dirty.clear();
                ack = undefined;
                analysis = undefined;
                analysisChanged = true;
            }
            project = projectId;
            touch();
            return discarded;
        },
        async clear() { await ready(); dirty.clear(); ack = undefined; analysis = undefined; analysisChanged = true; touch(); },
        async flush() { await ready(); await save(); },
        async reload() {
            await ready();
            await saving; // a save in flight is part of the file
            const savesBefore = savesBegun;
            let text;
            try {
                text = await persistence.read();
            }
            catch (error) {
                opts.onError?.(error);
                return;
            }
            if (!text)
                return; // nothing persisted: memory is the truth
            const from = parse(text);
            if (from.corrupt || from.legacy)
                return;
            if (from.projectId !== undefined && from.projectId !== project)
                return; // another project's queue is not ours to merge
            // Nothing unsaved here, and no save began while the file was read: the file IS this queue, as another opener left it.
            if (!changedSinceSave && savesBegun === savesBefore) {
                dirty.clear();
                add(from.keys);
                ack = from.ack;
            }
            else {
                // Our unsaved marks stay and the other opener's unsent keys join them (a resend is harmless, a lost key is not); the newer ack wins.
                const before = dirty.size;
                for (const k of from.keys)
                    if (!dirty.has(k))
                        dirty.set(k, ++seq);
                if (from.ack && (!ack || from.ack.generation > ack.generation))
                    ack = from.ack;
                if (dirty.size > before)
                    touch(); // a save that raced the read may have written without them
            }
        },
        onChange(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    };
}
//# sourceMappingURL=replicaQueue.js.map