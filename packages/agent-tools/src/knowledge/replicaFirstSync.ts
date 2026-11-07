/**
 * knowledge/replicaFirstSync.ts — the pump's FIRST-SYNC case (PRD 41 A11): a root whose local snapshot a
 * project has not seen (the root was reviewed before it was linked, or was linked to another project).
 * There is ONE upload path — the replica pump — and nothing is queued file by file: the root is simply
 * marked as owing a RECONCILE (the ack is forgotten). The pump then compares manifest trees and sends
 * exactly what the project lacks, or one full pack when it holds nothing for the root.
 *
 * A portable pack's upload is the same case over an in-memory store holding the pack's snapshot.
 */

import { filesManifestKey, srcRef, type KnowledgeStore } from '@seanhogg/builderforce-memory/knowledge';
import type { IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { analysisManifestKey } from './reviewRunner.js';
import type { ReplicaQueue } from './replicaQueue.js';

export interface FirstSyncCounts {
    sources: number;
    facts: number;
    relations: number;
}

/** The root's current sources: each reviewed file with its content hash, then the analyzers' root-level outputs. */
export async function currentSourcesOf(manifest: IngestManifest, rootId: string): Promise<Array<{ ref: string; hash: string }>> {
    return [
        ...((await manifest.get(filesManifestKey(rootId))) ?? []).map((f) => ({ ref: srcRef(rootId, f.id) as string, hash: f.hash })),
        ...((await manifest.get(analysisManifestKey(rootId))) ?? []).map((r) => ({ ref: r.id, hash: r.hash })),
    ];
}

/**
 * Marks the root as owing a reconcile and counts what the local store holds for it (`current` sources
 * that have extracted output, plus its facts and relations). `onProgress` is told once, complete.
 */
export async function enqueueSources(args: {
    rootId: string;
    local: KnowledgeStore;
    queue: ReplicaQueue;
    current: ReadonlyArray<{ ref: string; hash: string }>;
    onProgress?(done: number, total: number): void;
}): Promise<FirstSyncCounts> {
    const { rootId, local, queue } = args;
    let sources = 0;
    for (const { ref, hash } of args.current) {
        if ((await local.getExtracted?.(hash))?.some((e) => e.sourceRef === ref)) sources += 1;
    }
    args.onProgress?.(args.current.length, args.current.length);
    await queue.requestReconcile();
    const facts = await local.facts({ rootId });
    const relations = await local.relations({ rootId });
    return { sources, facts: facts.length, relations: relations.length };
}

/** A root reviewed locally, owing a full reconcile. Null when there is nothing local to send. */
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
