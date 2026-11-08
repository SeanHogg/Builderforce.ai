/**
 * knowledge/replicaHostParts.ts — the pure pieces of the replica host (`replicaHost.ts`): the atomic queue file and the
 * "server's copy" seed. Nothing here holds state.
 */

import type { KnowledgeClient } from '@builderforce/knowledge-client';
import type { KnowledgeFiles } from './fileManifest.js';
import type { ReadThrough, ReplicaPersistence } from './replicaQueue.js';
import type { PumpSource } from './replicaHost.js';

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
export function readThroughOf(pump: PumpSource): ReadThrough {
    const { client, rootId } = pump as PumpSource & { client: KnowledgeClient };
    return {
        preloadExtracted: async (hashes) => { await client.store.preloadExtracted?.(hashes); },
        getExtracted: (hash) => client.store.getExtracted?.(hash) ?? Promise.resolve(undefined),
        async humanKnowledge() {
            const [facts, relations] = await Promise.all([client.facts(rootId), client.store.relations({ rootId })]);
            return { facts: (facts?.facts ?? []).filter((f) => f.origin === 'human'), relations: relations.filter((r) => r.origin === 'human') };
        },
    };
}
