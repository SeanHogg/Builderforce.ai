/**
 * knowledge/index/packRetrieval.ts — THE seam between "which portable packs are loaded"
 * and "retrieve from them" (PRD 40, "The seam: pack registry → retrieval port").
 *
 *   PackRegistry        — a LIST of the packs available to this host/user/project;
 *   PackRetrievalPort   — a QUERY function: pack root ids + a question → the top cards;
 *   withPacks           — a host's own index recall merged with the loaded packs' recall.
 *
 * This is the ONE interface Synapse (through the editor's prefetch / context pack) and the
 * Canvas composer call. There is one retrieval implementation (the host knowledge index's
 * `recall`, per pack root), one embedding policy (a pack ships cards, never vectors: the
 * index re-embeds by card hash) and one dedupe rule ({@link mergeRecalls}). Nothing else is
 * shared: the registry is a list, the port is a query function, the `.bfpack` file is the
 * only on-disk contract.
 *
 * The editor's registry is its loaded-pack list (`clients/vscode/src/knowledge/packs/`). The
 * browser / Canvas registry is the project's uploaded packs (`packages/knowledge-browser/src/
 * browserPacks.ts`): per the PRD 40 decision of 2026-11-06 (OD-2) an uploaded pack is a knowledge
 * ROOT of the project (a `pack:` root id, `packRootIdFor`), not a table, so that registry lists the
 * project's scopes of `kind: 'pack'` and its port is this module's `packRetrievalPort` over
 * `searchRecall`. Both implement the interfaces below and nothing else here changed.
 *
 * Pure: no fs, no model, no vscode.
 */

import { compareStr, type IndexTier } from '@seanhogg/builderforce-memory/knowledge';
import type { HostKnowledgeIndexCore, Recall, RecalledHit } from './contract.js';

/** One loaded pack, as the registry lists it. */
export interface KnowledgePackEntry {
    name: string;
    /** The pack's reviewed root: the id of its index and the prefix of its cards' refs. */
    rootId: string;
    title: string;
    /** Where the pack file lives, when this host keeps it as a file. */
    path?: string;
    /** ISO time it was loaded (or last updated). */
    loadedAt: string;
    /** Who reviewed the pack and how, when the pack carries it (PRD 40, OD-3). */
    provenance?: { reviewedBy?: string; judgeModel?: string; policy?: string; reviewedAt?: string };
}

/** Which packs are available — a list, nothing more. */
export interface PackRegistry {
    list(): Promise<readonly KnowledgePackEntry[]>;
}

/** The query function: the top cards of the packs rooted at `packRootIds` for `query`. */
export interface PackRetrievalPort {
    recall(packRootIds: readonly string[], query: string, opts?: { k?: number }): Promise<Recall>;
}

/** The part of a host index the seam reads. */
export type RecallingIndex = Pick<HostKnowledgeIndexCore, 'recall'>;

/** Hits default to the host index's own default. */
const DEFAULT_K = 8;

/** A hit that may carry its card's content hash (equal content, different ids, is one answer). */
type HashedHit = RecalledHit & { hash?: string };

const better = (a: RecalledHit, b: RecalledHit): boolean => a.score > b.score || (a.score === b.score && compareStr(a.id, b.id) < 0);

/**
 * THE merge rule for recalls from several indexes: one hit per id (the highest score wins),
 * one per content hash when hits carry one, ordered by score descending then id, cut to `k`;
 * tiers are the union, the digest the stable join of the non-empty digests (sorted).
 */
export function mergeRecalls(recalls: readonly Recall[], k: number): Recall {
    const byId = new Map<string, RecalledHit>();
    for (const hit of recalls.flatMap((r) => r.hits)) {
        const seen = byId.get(hit.id);
        if (!seen || better(hit, seen)) byId.set(hit.id, hit);
    }
    const byHash = new Map<string, RecalledHit>();
    const unhashed: RecalledHit[] = [];
    for (const hit of byId.values()) {
        const hash = (hit as HashedHit).hash;
        if (!hash) {
            unhashed.push(hit);
            continue;
        }
        const seen = byHash.get(hash);
        if (!seen || better(hit, seen)) byHash.set(hash, hit);
    }
    const hits = [...unhashed, ...byHash.values()]
        .sort((a, b) => b.score - a.score || compareStr(a.id, b.id))
        .slice(0, Math.max(0, k));
    const tiers = [...new Set(recalls.flatMap((r) => r.tiers))].sort(compareStr) as IndexTier[];
    const digest = recalls.map((r) => r.digest).filter(Boolean).sort(compareStr).join('|');
    return { hits, tiers, digest };
}

export interface PackRetrievalPorts {
    /** The index of a pack's root (the host's per-root registry; created lazily). */
    indexOf(rootId: string): Promise<RecallingIndex> | RecallingIndex;
    /** A pack whose index failed is skipped and reported here, never a failed call. */
    onError?(rootId: string, error: unknown): void;
}

/** Recalls every pack's index in parallel and merges the hits with {@link mergeRecalls}. */
export function packRetrievalPort(ports: PackRetrievalPorts): PackRetrievalPort {
    return {
        async recall(packRootIds, query, opts = {}) {
            const k = opts.k ?? DEFAULT_K;
            const recalls = await Promise.all([...new Set(packRootIds)].map(async (rootId): Promise<Recall | undefined> => {
                try {
                    return await (await ports.indexOf(rootId)).recall(query, { k });
                } catch (error) {
                    ports.onError?.(rootId, error);
                    return undefined;
                }
            }));
            return mergeRecalls(recalls.filter((r): r is Recall => r !== undefined), k);
        },
    };
}

/**
 * A host index's recall with the loaded packs' recall merged in. `primary` is the host's own
 * index (the workspace's) and may be absent — a clean workspace, no folder open — in which
 * case the loaded packs alone answer. A failing primary does not hide the packs' answer.
 */
export function withPacks(primary: RecallingIndex | undefined, registry: PackRegistry, port: PackRetrievalPort): RecallingIndex {
    return {
        async recall(query, opts = {}) {
            const k = opts.k ?? DEFAULT_K;
            const own = primary
                ? await primary.recall(query, opts).then((value) => ({ value }), (error: unknown) => ({ error }))
                : undefined;
            const entries = await registry.list().catch(() => [] as readonly KnowledgePackEntry[]);
            const packs = entries.length > 0 ? await port.recall(entries.map((e) => e.rootId), query, { k }) : undefined;
            if (own && 'error' in own && !(packs && packs.hits.length > 0)) throw own.error;
            const primaryRecall = own && 'value' in own ? own.value : undefined;
            // Nothing to merge: the host index's answer stands as it is (its one-hop neighbours included).
            if (primaryRecall && !(packs && packs.hits.length > 0)) return primaryRecall;
            const parts = [primaryRecall, packs].filter((r): r is Recall => r !== undefined);
            // The primary's one-hop neighbours ride beyond `k`, so the merged list is never shorter than it was.
            return parts.length === 0 ? { hits: [], tiers: [], digest: '' } : mergeRecalls(parts, Math.max(k, primaryRecall?.hits.length ?? 0));
        },
    };
}
