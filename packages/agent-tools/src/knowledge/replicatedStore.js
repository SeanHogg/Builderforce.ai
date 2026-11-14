/**
 * knowledge/replicatedStore.ts — THE store every workspace review uses, linked or not (PRD 41 A7).
 *
 * The local store is the source of truth: every read and every write goes to it, so what the map
 * draws never depends on the server's version, reachability or rate limits. When the root is linked
 * (`replica` given) each write that CHANGED something marks its key in the replica's dirty set
 * (`replicaQueue.ts`), bound to the replica's project; the pump (`replicaPump.ts`) builds one pack from
 * the dirty keys later, off the review's path. An unlinked root passes no replica and the wrapper is
 * the local store.
 *
 * A key is marked only when its content digest differs from what the store held before (a file's hash,
 * a fact's or relation's digest): a re-review that rewrites unchanged rows marks nothing. What the store
 * held before is read once, lazily (`knownHashes` for the files, the local rows for facts and relations).
 * Marking is synchronous after the first call, and nothing here waits on a save.
 *
 * `readThrough` (the "Use the server's copy" seed) is a read-only hint, not a second import path:
 * before the review extracts changed files, `preloadExtracted` asks the server's bulk route for their
 * content hashes and seeds the LOCAL extracted cache with the hits, so unchanged-on-the-server files
 * cost no extraction; once, it also copies the root's human-authored facts (Add-fact notes) into the
 * local store. Seeded entries are not queued (the server already has them). If the server cannot be
 * reached the seed stops at the first failure and the review extracts as usual.
 */
import { factDigest, relationDigest } from '@seanhogg/builderforce-memory/knowledge/pack';
import { sourcePathIn } from './rootId.js';
import { factKey, fileKey, relationKey } from './replicaQueue.js';
export function replicatedKnowledgeStore(args) {
    const { local, replica, queue } = args;
    let bound;
    let isBound = false;
    /** Marks keys for the replica; never throws. Synchronous once the queue is bound to the project. */
    const mark = async (keys) => {
        if (!replica || keys.length === 0)
            return;
        try {
            if (!isBound) {
                if (replica.projectId !== undefined)
                    await (bound ??= queue.adopt(replica.projectId));
                isBound = true;
            }
            queue.markDirty(keys);
            args.onQueued?.();
        }
        catch (error) {
            args.onError?.(error);
        }
    };
    // What the store held before this session's writes — loaded once, then kept current.
    let hashes;
    let rowDigests;
    const knownHashes = async () => {
        if (!hashes) {
            try {
                hashes = new Map((await args.knownHashes?.()) ?? []);
            }
            catch (error) {
                args.onError?.(error);
                hashes = new Map();
            }
        }
        return hashes;
    };
    const knownRows = async () => {
        if (!rowDigests) {
            rowDigests = new Map();
            try {
                if (args.rootId) {
                    for (const f of await local.facts({ rootId: args.rootId }))
                        rowDigests.set(factKey(f.key), factDigest(f));
                    for (const r of await local.relations({ rootId: args.rootId }))
                        rowDigests.set(relationKey(r), relationDigest(r));
                }
            }
            catch (error) {
                args.onError?.(error);
            }
        }
        return rowDigests;
    };
    /** Marks the file when its hash differs from the one held before ('' = removed). */
    const fileChanged = async (ref, rootId, hash) => {
        if (!replica)
            return [];
        const known = await knownHashes();
        if (known.get(ref) === hash)
            return [];
        if (hash)
            known.set(ref, hash);
        else
            known.delete(ref);
        return [fileKey(sourcePathIn(ref, rootId ?? ''), hash)];
    };
    /** File keys staled but not yet given their output: the ones a pump may have held back. */
    const staled = new Set();
    let humanSeeded = false;
    /** Seeds the local cache from the server for hashes the local store lacks. Never throws. */
    const seed = async (hashes) => {
        const through = replica?.readThrough;
        if (!through)
            return;
        try {
            if (!humanSeeded && through.humanKnowledge && args.rootId) {
                humanSeeded = true;
                const human = await through.humanKnowledge();
                if (human.facts.length + human.relations.length > 0) {
                    const scope = (await local.scopes()).find((s) => s.rootId === args.rootId) ?? { rootId: args.rootId, title: args.rootId, packs: [] };
                    await local.write({ scope, facts: human.facts, relations: human.relations });
                }
            }
            if (!through.getExtracted || !local.putExtracted || !local.getExtracted)
                return;
            const missing = [];
            for (const h of new Set(hashes))
                if (!(await local.getExtracted(h)))
                    missing.push(h);
            if (missing.length === 0)
                return;
            await through.preloadExtracted?.(missing);
            for (const h of missing) {
                const hit = await through.getExtracted(h);
                if (hit)
                    await local.putExtracted(h, hit); // an explicit [] (nothing extracted) is kept distinct from absent
            }
        }
        catch (error) {
            args.onError?.(error); // offline or rate-limited: the review extracts what it still lacks
        }
    };
    const store = {
        scopes: () => local.scopes(),
        facts: (scope) => local.facts(scope),
        relations: (scope) => local.relations(scope),
        async write(batch) {
            // What the store held BEFORE this write is read first: read after it, every row would look unchanged.
            const known = replica ? await knownRows() : undefined;
            await local.write(batch);
            if (!known)
                return;
            const keys = [];
            for (const f of batch.facts) {
                const k = factKey(f.key), d = factDigest(f);
                if (known.get(k) !== d) {
                    known.set(k, d);
                    keys.push(k);
                }
            }
            for (const r of batch.relations) {
                const k = relationKey(r), d = relationDigest(r);
                if (known.get(k) !== d) {
                    known.set(k, d);
                    keys.push(k);
                }
            }
            await mark(keys);
        },
        async markStale(scope, sourceRef, currentHash) {
            await local.markStale(scope, sourceRef, currentHash);
            const keys = await fileChanged(sourceRef, scope.rootId, currentHash);
            // Remember only a file staled with no output yet (a live edit): its output is still to come.
            if (keys.length > 0 && currentHash !== '' && (await local.getExtracted?.(currentHash)) === undefined)
                for (const k of keys)
                    staled.add(k);
            await mark(keys);
        },
        async preloadExtracted(hashes) {
            await seed(hashes);
            await local.preloadExtracted?.(hashes);
        },
        async batched(work) {
            // The dirty set is made durable BEFORE the local store: a crash can leave it ahead of the
            // snapshot (a harmless re-send), never the snapshot ahead of it (a lost send).
            const run = async (flush) => {
                try {
                    return await work(async () => { await queue.flush(); await flush(); });
                }
                finally {
                    await queue.flush(); // a save only when a key changed
                }
            };
            return local.batched ? local.batched(run) : run(async () => undefined);
        },
    };
    if (local.getExtracted)
        store.getExtracted = (hash) => local.getExtracted(hash);
    // The re-check channel is the local store's: the pump asks, the next review answers (no replica traffic of its own).
    if (local.markRecheck)
        store.markRecheck = (hashes) => local.markRecheck(hashes);
    if (local.recheckHashes)
        store.recheckHashes = () => local.recheckHashes();
    if (local.clearRecheck)
        store.clearRecheck = (hashes) => local.clearRecheck(hashes);
    if (local.hasRecheck)
        store.hasRecheck = (hash) => local.hasRecheck(hash);
    if (local.putExtracted) {
        store.putExtracted = async (hash, extracted) => {
            // What this hash held before: a body that was `[]` (nothing extracted) now gets an entry, which replaces
            // the project's entry-less marker. The file's hash is unchanged, so nothing else would send it.
            const before = await local.getExtracted?.(hash);
            await local.putExtracted(hash, extracted);
            const keys = [];
            for (const e of extracted) {
                keys.push(...(await fileChanged(e.sourceRef, args.rootId, hash)));
                if (before && before.length === 0 && replica)
                    keys.push(fileKey(sourcePathIn(e.sourceRef, args.rootId ?? ''), hash));
            }
            await mark(keys);
            // A file staled before its output was stored (a live edit) may already have been held back by a pump that ran in between: the same
            // hash is not a change, so nothing re-kicked it. Kick the pump when this output is one that was waited for. Debounced by the host.
            const waited = extracted.some((e) => staled.delete(fileKey(sourcePathIn(e.sourceRef, args.rootId ?? ''), hash)))
                || (await local.hasRecheck?.(hash)) === true; // an answer of [] (nothing extracted) is as much an answer as a body
            if (waited)
                args.onQueued?.();
        };
    }
    return store;
}
//# sourceMappingURL=replicatedStore.js.map