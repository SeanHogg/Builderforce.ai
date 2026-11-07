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

import type { Extracted, KnowledgeStore, NodeRef, Scope, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { factDigest, relationDigest } from '@seanhogg/builderforce-memory/knowledge/pack';
import { factKey, fileKey, relationKey, type ReplicaQueue } from './replicaQueue.js';

/** The server's copy, read-only (a client store satisfies the first two). */
export interface ReadThrough {
    preloadExtracted?(hashes: readonly string[]): Promise<void>;
    getExtracted?(hash: string): Promise<Extracted[] | undefined>;
    /** The root's human-authored facts and relations (Add-fact notes), which no file can re-derive. */
    humanKnowledge?(): Promise<{ facts: StoredFact[]; relations: StoredRelation[] }>;
}

/** The linked project's replica. */
export interface ReplicaTarget {
    /** The project the queue is bound to; a queue filled for another project is discarded. */
    projectId?: number;
    readThrough?: ReadThrough;
}

export interface ReplicatedStoreArgs {
    local: KnowledgeStore;
    /** Present when the root is linked: its changes mark the replica's dirty set. */
    replica?: ReplicaTarget;
    queue: ReplicaQueue;
    /** The root (needed to seed its human facts). */
    rootId?: string;
    /** Told after keys were marked (a host may start its pump when no review is running). */
    onQueued?(): void;
    /** `sourceRef` → content hash as of the last local review: what an unchanged file is compared with. Read once, lazily. */
    knownHashes?(): Promise<ReadonlyMap<string, string>>;
    onError?(error: unknown): void;
}

export function replicatedKnowledgeStore(args: ReplicatedStoreArgs): KnowledgeStore {
    const { local, replica, queue } = args;
    let bound: Promise<unknown> | undefined;
    let isBound = false;
    /** Marks keys for the replica; never throws. Synchronous once the queue is bound to the project. */
    const mark = async (keys: readonly string[]): Promise<void> => {
        if (!replica || keys.length === 0) return;
        try {
            if (!isBound) {
                if (replica.projectId !== undefined) await (bound ??= queue.adopt(replica.projectId));
                isBound = true;
            }
            queue.markDirty(keys);
            args.onQueued?.();
        } catch (error) {
            args.onError?.(error);
        }
    };

    // What the store held before this session's writes — loaded once, then kept current.
    let hashes: Map<string, string> | undefined;
    let rowDigests: Map<string, string> | undefined;
    const knownHashes = async (): Promise<Map<string, string>> => {
        if (!hashes) {
            try { hashes = new Map((await args.knownHashes?.()) ?? []); } catch (error) { args.onError?.(error); hashes = new Map(); }
        }
        return hashes;
    };
    const knownRows = async (): Promise<Map<string, string>> => {
        if (!rowDigests) {
            rowDigests = new Map();
            try {
                if (args.rootId) {
                    for (const f of await local.facts({ rootId: args.rootId })) rowDigests.set(factKey(f.key), factDigest(f));
                    for (const r of await local.relations({ rootId: args.rootId })) rowDigests.set(relationKey(r), relationDigest(r));
                }
            } catch (error) { args.onError?.(error); }
        }
        return rowDigests;
    };
    /** The source path of a ref of this root (the root id may itself contain colons). */
    const pathOf = (ref: string, rootId: string | undefined): string => {
        const prefix = rootId ? `src:${rootId}::` : undefined;
        if (prefix && ref.startsWith(prefix)) return ref.slice(prefix.length);
        const at = ref.indexOf('::');
        return at >= 0 ? ref.slice(at + 2) : ref;
    };
    /** Marks the file when its hash differs from the one held before ('' = removed). */
    const fileChanged = async (ref: string, rootId: string | undefined, hash: string): Promise<string[]> => {
        if (!replica) return [];
        const known = await knownHashes();
        if (known.get(ref) === hash) return [];
        if (hash) known.set(ref, hash); else known.delete(ref);
        return [fileKey(pathOf(ref, rootId), hash)];
    };

    let humanSeeded = false;
    /** Seeds the local cache from the server for hashes the local store lacks. Never throws. */
    const seed = async (hashes: readonly string[]): Promise<void> => {
        const through = replica?.readThrough;
        if (!through) return;
        try {
            if (!humanSeeded && through.humanKnowledge && args.rootId) {
                humanSeeded = true;
                const human = await through.humanKnowledge();
                if (human.facts.length + human.relations.length > 0) {
                    const scope = (await local.scopes()).find((s) => s.rootId === args.rootId) ?? { rootId: args.rootId, title: args.rootId, packs: [] };
                    await local.write({ scope, facts: human.facts, relations: human.relations });
                }
            }
            if (!through.getExtracted || !local.putExtracted || !local.getExtracted) return;
            const missing: string[] = [];
            for (const h of new Set(hashes)) if (!(await local.getExtracted(h))) missing.push(h);
            if (missing.length === 0) return;
            await through.preloadExtracted?.(missing);
            for (const h of missing) {
                const hit = await through.getExtracted(h);
                if (hit && hit.length > 0) await local.putExtracted(h, hit);
            }
        } catch (error) {
            args.onError?.(error); // offline or rate-limited: the review extracts what it still lacks
        }
    };

    const store: KnowledgeStore = {
        scopes: () => local.scopes(),
        facts: (scope: Scope) => local.facts(scope),
        relations: (scope: Scope) => local.relations(scope),
        async write(batch) {
            // What the store held BEFORE this write is read first: read after it, every row would look unchanged.
            const known = replica ? await knownRows() : undefined;
            await local.write(batch);
            if (!known) return;
            const keys: string[] = [];
            for (const f of batch.facts) {
                const k = factKey(f.key), d = factDigest(f);
                if (known.get(k) !== d) { known.set(k, d); keys.push(k); }
            }
            for (const r of batch.relations) {
                const k = relationKey(r), d = relationDigest(r);
                if (known.get(k) !== d) { known.set(k, d); keys.push(k); }
            }
            await mark(keys);
        },
        async markStale(scope, sourceRef: NodeRef, currentHash) {
            await local.markStale(scope, sourceRef, currentHash);
            await mark(await fileChanged(sourceRef, scope.rootId, currentHash));
        },
        async preloadExtracted(hashes) {
            await seed(hashes);
            await local.preloadExtracted?.(hashes);
        },
        async batched<T>(work: (flush: () => Promise<void>) => Promise<T>): Promise<T> {
            // The dirty set is made durable BEFORE the local store: a crash can leave it ahead of the
            // snapshot (a harmless re-send), never the snapshot ahead of it (a lost send).
            const run = async (flush: () => Promise<void>): Promise<T> => {
                try {
                    return await work(async () => { await queue.flush(); await flush(); });
                } finally {
                    await queue.flush(); // a save only when a key changed
                }
            };
            return local.batched ? local.batched(run) : run(async () => undefined);
        },
    };
    if (local.getExtracted) store.getExtracted = (hash) => local.getExtracted!(hash);
    if (local.putExtracted) {
        store.putExtracted = async (hash, extracted) => {
            await local.putExtracted!(hash, extracted);
            const keys: string[] = [];
            for (const e of extracted) keys.push(...(await fileChanged(e.sourceRef, args.rootId, hash)));
            await mark(keys);
        };
    }
    return store;
}
