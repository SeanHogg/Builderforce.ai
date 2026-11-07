/**
 * knowledge/replicaFirstSync.ts — the pump's FIRST-SYNC case (PRD 41 A7): a root's whole local
 * snapshot, queued once for a project that has not seen it (the root was reviewed before it was
 * linked, or was linked to another project). There is ONE upload path — the replica pump — and this
 * only fills its queue: each current source's extracted output and hash, then the facts and
 * relations with the scope. Every send is an upsert on the platform's unique key, so queueing the
 * same snapshot twice changes nothing.
 *
 * A portable pack's upload is the same case over an in-memory store holding the pack's snapshot.
 */

import { filesManifestKey, srcRef, type KnowledgeStore, type ScopeRecord } from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { analysisManifestKey } from './reviewRunner.js';
import { relationKey, type ReplicaQueue } from './replicaQueue.js';

export interface FirstSyncCounts {
    sources: number;
    facts: number;
    relations: number;
}

/** Root-level outputs (analyzers) are keyed by a `~` digest, never by a source's content hash. */
const isSourceHash = (hash: string): boolean => !hash.startsWith('~');

/** The root's current sources: each reviewed file with its content hash, then the analyzers' root-level outputs. */
export async function currentSourcesOf(manifest: IngestManifest, rootId: string): Promise<Array<{ ref: string; hash: string }>> {
    return [
        ...((await manifest.get(filesManifestKey(rootId))) ?? []).map((f) => ({ ref: srcRef(rootId, f.id) as string, hash: f.hash })),
        ...((await manifest.get(analysisManifestKey(rootId))) ?? []).map((r) => ({ ref: r.id, hash: r.hash })),
    ];
}

/**
 * Queues `current` sources (those the local store holds extracted output for), then the root's facts
 * and relations with its scope. `onProgress` counts every source processed, so it reaches the total
 * even past a source with no output.
 */
export async function enqueueSources(args: {
    rootId: string;
    local: KnowledgeStore;
    queue: ReplicaQueue;
    current: ReadonlyArray<{ ref: string; hash: string }>;
    onProgress?(done: number, total: number): void;
}): Promise<FirstSyncCounts> {
    const { rootId, local, queue } = args;
    let sources = 0, processed = 0;
    for (const { ref, hash } of args.current) {
        processed += 1;
        const entry = (await local.getExtracted?.(hash))?.find((e) => e.sourceRef === ref);
        if (entry) {
            await queue.enqueue({ op: 'putExtracted', hash });
            // Records the source's current hash on the platform (the graph lists the root by it).
            if (isSourceHash(hash)) await queue.enqueue({ op: 'markStale', rootId, sourceRef: entry.sourceRef, hash });
            sources += 1;
        }
        args.onProgress?.(processed, args.current.length);
    }
    const scope: ScopeRecord = (await local.scopes()).find((s) => s.rootId === rootId) ?? { rootId, title: rootId, packs: [] };
    const facts = await local.facts({ rootId });
    const relations = await local.relations({ rootId });
    // Chunks of ≤ 500 rows, then the scope as its own last op.
    await queue.enqueueWrite({ rootId, scope, facts: facts.map((f) => f.key), relations: relations.map(relationKey) });
    return { sources, facts: facts.length, relations: relations.length };
}

/** A root reviewed locally, queued whole. Null when there is nothing local to send. */
export async function enqueueFirstSync(args: {
    rootId: string;
    local: KnowledgeStore;
    manifest: IngestManifest;
    queue: ReplicaQueue;
}): Promise<FirstSyncCounts | null> {
    const current = await currentSourcesOf(args.manifest, args.rootId);
    if (current.length === 0) return null;
    return enqueueSources({ rootId: args.rootId, local: args.local, queue: args.queue, current });
}
