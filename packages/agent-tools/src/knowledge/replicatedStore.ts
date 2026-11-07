/**
 * knowledge/replicatedStore.ts — THE store every workspace review uses, linked or not (PRD 41 A7).
 *
 * The local store is the source of truth: every read and every write goes to it, so what the map
 * draws never depends on the server's version, reachability or rate limits. When the root is linked
 * (`replica` given) each write is ALSO appended to the replica queue (`replicaQueue.ts`), bound to the
 * replica's project; the pump (`replicaPump.ts`) sends it later, off the review's path. An unlinked
 * root passes no replica and the wrapper is the local store.
 *
 * `readThrough` (the "Use the server's copy" seed) is a read-only hint, not a second import path:
 * before the review extracts changed files, `preloadExtracted` asks the server's bulk route for their
 * content hashes and seeds the LOCAL extracted cache with the hits, so unchanged-on-the-server files
 * cost no extraction; once, it also copies the root's human-authored facts (Add-fact notes) into the
 * local store. Seeded entries are not queued (the server already has them). If the server cannot be
 * reached the seed stops at the first failure and the review extracts as usual.
 */

import type { Extracted, KnowledgeStore, NodeRef, Scope, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import { relationKey, type ReplicaQueue } from './replicaQueue.js';

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
    /** Present when the root is linked: its writes are queued for the replica. */
    replica?: ReplicaTarget;
    queue: ReplicaQueue;
    /** The root (needed to seed its human facts). */
    rootId?: string;
    /** Told after a write was queued (a host may start its pump when no review is running). */
    onQueued?(): void;
    onError?(error: unknown): void;
}

export function replicatedKnowledgeStore(args: ReplicatedStoreArgs): KnowledgeStore {
    const { local, replica, queue } = args;
    let bound: Promise<unknown> | undefined;
    /** Queues for the replica; never throws. */
    const toReplica = async (queued: () => Promise<void>): Promise<void> => {
        if (!replica) return;
        try {
            if (replica.projectId !== undefined) await (bound ??= queue.adopt(replica.projectId));
            await queued();
            args.onQueued?.();
        } catch (error) {
            args.onError?.(error);
        }
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
            await local.write(batch);
            await toReplica(() => queue.enqueueWrite({
                rootId: batch.scope.rootId, scope: batch.scope,
                facts: batch.facts.map((f) => f.key), relations: batch.relations.map(relationKey),
            }));
        },
        async markStale(scope, sourceRef: NodeRef, currentHash) {
            await local.markStale(scope, sourceRef, currentHash);
            await toReplica(() => queue.enqueue({ op: 'markStale', rootId: scope.rootId, sourceRef, hash: currentHash }));
        },
        async preloadExtracted(hashes) {
            await seed(hashes);
            await local.preloadExtracted?.(hashes);
        },
        async batched<T>(work: (flush: () => Promise<void>) => Promise<T>): Promise<T> {
            // The queue is made durable BEFORE the local store: a crash can leave the queue ahead of the
            // snapshot (a harmless re-send), never the snapshot ahead of the queue (a lost send).
            const run = async (flush: () => Promise<void>): Promise<T> => {
                try {
                    return await work(async () => { await queue.flush(); await flush(); });
                } finally {
                    await queue.flush();
                }
            };
            return local.batched ? local.batched(run) : run(async () => undefined);
        },
    };
    if (local.getExtracted) store.getExtracted = (hash) => local.getExtracted!(hash);
    if (local.putExtracted) {
        store.putExtracted = async (hash, extracted) => {
            await local.putExtracted!(hash, extracted);
            await toReplica(() => queue.enqueue({ op: 'putExtracted', hash }));
        };
    }
    return store;
}
