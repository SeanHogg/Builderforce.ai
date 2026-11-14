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
import { compareStr } from '@seanhogg/builderforce-memory/knowledge';
/** Hits default to the host index's own default. */
const DEFAULT_K = 8;
const better = (a, b) => a.score > b.score || (a.score === b.score && compareStr(a.id, b.id) < 0);
/**
 * THE merge rule for recalls from several indexes: one hit per id (the highest score wins),
 * one per content hash when hits carry one, ordered by score descending then id, cut to `k`;
 * tiers are the union, the digest the stable join of the non-empty digests (sorted).
 */
export function mergeRecalls(recalls, k) {
    const byId = new Map();
    for (const hit of recalls.flatMap((r) => r.hits)) {
        const seen = byId.get(hit.id);
        if (!seen || better(hit, seen))
            byId.set(hit.id, hit);
    }
    const byHash = new Map();
    const unhashed = [];
    for (const hit of byId.values()) {
        const hash = hit.hash;
        if (!hash) {
            unhashed.push(hit);
            continue;
        }
        const seen = byHash.get(hash);
        if (!seen || better(hit, seen))
            byHash.set(hash, hit);
    }
    const hits = [...unhashed, ...byHash.values()]
        .sort((a, b) => b.score - a.score || compareStr(a.id, b.id))
        .slice(0, Math.max(0, k));
    const tiers = [...new Set(recalls.flatMap((r) => r.tiers))].sort(compareStr);
    const digest = recalls.map((r) => r.digest).filter(Boolean).sort(compareStr).join('|');
    return { hits, tiers, digest };
}
/** Recalls every pack's index in parallel and merges the hits with {@link mergeRecalls}. */
export function packRetrievalPort(ports) {
    return {
        async recall(packRootIds, query, opts = {}) {
            const k = opts.k ?? DEFAULT_K;
            const recalls = await Promise.all([...new Set(packRootIds)].map(async (rootId) => {
                try {
                    return await (await ports.indexOf(rootId)).recall(query, { k });
                }
                catch (error) {
                    ports.onError?.(rootId, error);
                    return undefined;
                }
            }));
            return mergeRecalls(recalls.filter((r) => r !== undefined), k);
        },
    };
}
/**
 * A host index's recall with the loaded packs' recall merged in. `primary` is the host's own
 * index (the workspace's) and may be absent — a clean workspace, no folder open — in which
 * case the loaded packs alone answer. A failing primary does not hide the packs' answer.
 */
export function withPacks(primary, registry, port) {
    return {
        async recall(query, opts = {}) {
            const k = opts.k ?? DEFAULT_K;
            const own = primary
                ? await primary.recall(query, opts).then((value) => ({ value }), (error) => ({ error }))
                : undefined;
            const entries = await registry.list().catch(() => []);
            const packs = entries.length > 0 ? await port.recall(entries.map((e) => e.rootId), query, { k }) : undefined;
            if (own && 'error' in own && !(packs && packs.hits.length > 0))
                throw own.error;
            const primaryRecall = own && 'value' in own ? own.value : undefined;
            // Nothing to merge: the host index's answer stands as it is (its one-hop neighbours included).
            if (primaryRecall && !(packs && packs.hits.length > 0))
                return primaryRecall;
            const parts = [primaryRecall, packs].filter((r) => r !== undefined);
            // The primary's one-hop neighbours ride beyond `k`, so the merged list is never shorter than it was.
            return parts.length === 0 ? { hits: [], tiers: [], digest: '' } : mergeRecalls(parts, Math.max(k, primaryRecall?.hits.length ?? 0));
        },
    };
}
//# sourceMappingURL=packRetrieval.js.map