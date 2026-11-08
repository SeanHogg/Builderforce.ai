/**
 * knowledge/replicaHostParts.ts — the pure pieces of the replica host (`replicaHost.ts`): the atomic queue file and the
 * "server's copy" seed. Nothing here holds state.
 */

import type { Extracted, StoredFact, StoredRelation } from '@seanhogg/builderforce-memory/knowledge';
import type { KnowledgeFiles } from './fileManifest.js';
import type { ReplicaClient } from './replicaPump.js';
import type { ReplicaPersistence } from './replicaQueue.js';
import type { ReadThrough } from './replicatedStore.js';

/** What the "use the server's copy" seed reads from the client beyond the pump's own calls (a `KnowledgeClient` satisfies it). */
export interface SeedPort {
    /** `null` when the root is unknown to the server (the client's own answer). */
    facts(rootId: string): Promise<{ facts?: readonly StoredFact[] } | null | undefined>;
    store: {
        relations(q: { rootId: string }): Promise<readonly StoredRelation[]>;
        preloadExtracted?(hashes: readonly string[]): Promise<unknown>;
        getExtracted?(hash: string): Promise<Extracted[] | undefined>;
    };
}

/** The queue file, written atomically: a crash leaves the old file or the new one, never half of either. */
export function persistenceOf(files: KnowledgeFiles, name: string): ReplicaPersistence {
    return {
        read: () => files.read(name),
        async write(text) {
            if (!files.rename) { await files.write(name, text); return; }
            const temp = `${name}.tmp`;
            await files.write(temp, text);
            await files.rename(temp, name);
        },
        keepAside: (text) => files.write(`${name}.corrupt`, text),
        ...(files.remove ? { remove: () => files.remove!(name) } : {}),
    };
}

/** The server's copy as the seed reads it: extracted output by hash, and the root's human-authored facts. */
export function readThroughOf(client: SeedPort, rootId: string): ReadThrough {
    return {
        preloadExtracted: async (hashes: readonly string[]) => { await client.store.preloadExtracted?.([...hashes]); },
        getExtracted: (hash: string) => client.store.getExtracted?.(hash) ?? Promise.resolve(undefined),
        async humanKnowledge() {
            const [facts, relations] = await Promise.all([client.facts(rootId), client.store.relations({ rootId })]);
            return {
                facts: (facts?.facts ?? []).filter((f) => f.origin === 'human') as StoredFact[],
                relations: relations.filter((r) => r.origin === 'human') as StoredRelation[],
            };
        },
    };
}

/** The client a host hands the pump: the pump's own calls plus the seed's reads (a real `KnowledgeClient` satisfies it). */
export type ReplicaHostClient = ReplicaClient & SeedPort;
