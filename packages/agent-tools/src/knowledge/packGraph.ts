/**
 * knowledge/packGraph.ts — the pure halves of the portable pack that touch a reviewed
 * root's store (PRD 40): a store's pack (`packFromStore`) and a pack's graph (`packGraph`).
 * The editor's pack commands, the knowledge panel (a loaded pack as a read-only root) and
 * the acceptance test all go through these two; none of them re-implements the pack ↔ graph
 * round trip.
 *
 * Pure over ports: no vscode, no fs.
 */

import {
    compareStr, filesManifestKey, localSnapshotStore, toCards,
    type IndexDoc, type KnowledgeGraph, type KnowledgePack, type KnowledgeSnapshot, type KnowledgeStore, type PlanDetail,
} from '@seanhogg/builderforce-memory/knowledge';
import { InMemoryIngestManifest, type IngestManifest } from '@seanhogg/builderforce-memory/ingest';
import { currentFileHashes } from './fileEdits.js';
import { mergePacks, packFromSnapshot, type PackProvenance, type PortableKnowledgePack } from './portablePack.js';
import { analysisManifestKey, buildStoredGraph, reviewPacks } from './reviewRunner.js';
import { ROOT_OUTPUT_HASH_PREFIX } from './codeNodes.js';
import { sourcePathOf } from './rootId.js';

export interface PackFromStoreArgs {
    name: string;
    rootId: string;
    title: string;
    store: KnowledgeStore;
    manifest: IngestManifest;
    /** The root's extracted cache (keyed by content hash); the store does not expose it as a whole. */
    extracted: KnowledgeSnapshot['extracted'];
    /** The packs the root's graph is built with; default the review's own list. */
    packs?: KnowledgePack[];
    /** ISO clock. */
    now?(): string;
    /** Who reviewed it and with what (see {@link PackProvenance}); recorded on the pack as given. */
    provenance?: PackProvenance;
    /** The cards could not be built (the pack is written without them; a consumer rebuilds them). */
    onError?(error: unknown): void;
}

/**
 * {@link mergePacks} with its cards rebuilt from the MERGED snapshot (`toCards` of the merged
 * graph), so what a consumer indexes matches the facts and files the pack now holds — never
 * the fresh review's cards alone, nor the base's stale ones. No graph ⇒ no cards.
 */
export async function mergePacksWithCards(
    base: PortableKnowledgePack,
    fresh: PortableKnowledgePack,
    opts: { now?(): string; mirror?: boolean } = {},
): Promise<PortableKnowledgePack> {
    const { cards: _stale, ...merged } = mergePacks(base, fresh, opts);
    const graph = await packGraph(merged);
    return graph ? { ...merged, cards: toCards(graph) } : merged;
}

/**
 * Whether a review of this plan would do anything: a file whose content moved or is owed a
 * re-extraction, or a file gone. A plan with none and a root already in the store needs no
 * review before packing (Create Knowledge Pack skips it).
 */
export function reviewHasWork(detail: Pick<PlanDetail, 'plan' | 'files'>): boolean {
    return detail.plan.removed.length > 0 || detail.files.some((f) => f.changed || f.owed);
}

/** The content hashes the root's graph reads: its files' current hashes and its analysis outputs'. */
async function liveHashes(manifest: IngestManifest, rootId: string): Promise<Set<string>> {
    const [files, roots] = await Promise.all([currentFileHashes(manifest, rootId), manifest.get(analysisManifestKey(rootId))]);
    return new Set([...files.values(), ...(roots ?? []).map((r) => r.hash)]);
}

/**
 * A reviewed root's pack from what its reviews left in the store: ONLY the root's own scope,
 * facts and relations (a store can hold other roots), the extracted cache, and the retrieval
 * cards of its stored graph when the graph builds (a never-reviewed root has none).
 */
export async function packFromStore(args: PackFromStoreArgs): Promise<PortableKnowledgePack> {
    const { rootId, store } = args;
    const [scopes, facts, relations, live] = await Promise.all([
        store.scopes(), store.facts({ rootId }), store.relations({ rootId }), liveHashes(args.manifest, rootId),
    ]);
    const snapshot: KnowledgeSnapshot = {
        version: 1,
        scopes: scopes.filter((s) => s.rootId === rootId),
        facts: { [rootId]: facts },
        relations: { [rootId]: relations },
        // The cache keeps every hash a file ever had; the pack carries only the ones the root holds NOW.
        extracted: Object.fromEntries(Object.entries(args.extracted).filter(([hash]) => live.has(hash))),
    };
    let cards: IndexDoc[] | undefined;
    try {
        const graph = await buildStoredGraph({ rootId, store, manifest: args.manifest, packs: args.packs ?? reviewPacks({}) });
        if (graph) cards = toCards(graph);
    } catch (error) {
        args.onError?.(error);
    }
    return packFromSnapshot({
        name: args.name,
        rootId,
        title: args.title,
        snapshot,
        ...(cards ? { cards } : {}),
        ...(args.now ? { now: args.now } : {}),
        ...(args.provenance ? { provenance: args.provenance } : {}),
    });
}

/** How a graph is read: the refs to load around and the node cap (the panel's `GraphQuery`). */
export interface PackGraphQuery { focus?: string[]; maxNodes?: number }

/**
 * The review manifest a pack implies: its extracted records name the reviewed files (hash by
 * path) and the root-level analysis outputs, which is what `buildStoredGraph` reads.
 */
async function manifestOfPack(pack: PortableKnowledgePack): Promise<IngestManifest> {
    const manifest = new InMemoryIngestManifest();
    const files = new Map<string, string>();
    const roots = new Map<string, string>();
    // Sorted by hash so a pack still holding two hashes of one file resolves the same way everywhere.
    for (const hash of Object.keys(pack.snapshot.extracted).sort(compareStr)) {
        for (const e of pack.snapshot.extracted[hash]!) {
            const path = sourcePathOf(e.sourceRef, pack.rootId);
            if (path === undefined || e.sourceHash.startsWith(ROOT_OUTPUT_HASH_PREFIX) || path.includes('#')) roots.set(e.sourceRef, e.sourceHash);
            else files.set(path, e.sourceHash);
        }
    }
    await manifest.set(filesManifestKey(pack.rootId), [...files].map(([id, hash]) => ({ id, hash })));
    await manifest.set(analysisManifestKey(pack.rootId), [...roots].map(([id, hash]) => ({ id, hash })));
    return manifest;
}

/**
 * A pack's knowledge graph, rebuilt from its snapshot alone (no folder, no review): the
 * snapshot in an in-memory store plus the manifest its extracted records imply. Null when the
 * pack holds nothing extracted.
 */
export async function packGraph(pack: PortableKnowledgePack, query: PackGraphQuery = {}): Promise<KnowledgeGraph | null> {
    const store = localSnapshotStore({
        read: () => Promise.resolve(JSON.stringify(pack.snapshot)),
        write: () => Promise.resolve(),
    });
    return buildStoredGraph({
        rootId: pack.rootId,
        store,
        manifest: await manifestOfPack(pack),
        packs: reviewPacks({}),
        ...(query.focus?.length ? { focus: query.focus } : {}),
        ...(query.maxNodes ? { maxNodes: query.maxNodes } : {}),
    });
}
