/**
 * Recall over a REMOTE index (docs/design/deterministic-knowledge-index.md, "Consumers") —
 * what a browser host (web, Rovr) answers `knowledge.ask` from: it keeps no local index,
 * so a question is the platform's `search` over a reviewed root plus one hop of the
 * root's server-built graph around the hits (`graph(focus)`). The shape is the local
 * index's `recall`, so the ONE `knowledgeAskExecutor` — its `hitConfidence`, its
 * renderers — answers the same way on every host. Pure: both reads are injected.
 */
import { pathOfRef } from '@seanhogg/builderforce-memory/knowledge';
/** A one-hop neighbour scores this share of the hit it was reached from. */
export const NEIGHBOUR_SCORE_SHARE = 0.5;
const metaOf = (node) => node ? { kind: node.kind, label: node.label, ...(node.partition ? { partition: node.partition } : {}) } : undefined;
function recalled(hit, node, expanded) {
    const path = pathOfRef(hit.id);
    const meta = metaOf(node);
    return { ...hit, ...(path ? { path } : {}), ...(meta ? { meta } : {}), ...(expanded ? { expanded: true } : {}) };
}
/** `recall` over a remote search and graph — the `knowledge.ask` host for a browser. */
export function searchRecall(ports) {
    return {
        async recall(q, opts = {}) {
            const k = opts.k ?? 8;
            const hits = await ports.search(q, k);
            const tiers = [...new Set(hits.map((h) => h.tier))];
            if (hits.length === 0)
                return { hits: [], tiers, digest: '' };
            const graph = await ports.graph(hits.map((h) => h.id)).catch(() => null);
            const nodes = new Map((graph?.nodes ?? []).map((n) => [n.ref, n]));
            const own = new Set(hits.map((h) => h.id));
            const out = hits.map((h) => recalled(h, nodes.get(h.id), false));
            const reached = new Map();
            for (const hit of hits) {
                for (const edge of graph?.edges ?? []) {
                    const other = edge.from === hit.id ? edge.to : edge.to === hit.id ? edge.from : undefined;
                    if (!other || own.has(other))
                        continue;
                    const score = hit.score * Math.min(1, Math.max(0, edge.weight)) * NEIGHBOUR_SCORE_SHARE;
                    const prior = reached.get(other);
                    if (!prior || prior.score < score)
                        reached.set(other, recalled({ id: other, score, tier: hit.tier }, nodes.get(other), true));
                }
            }
            const neighbours = [...reached.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
            return { hits: [...out, ...neighbours].slice(0, k * 2), tiers, digest: graph?.scope.digest ?? '' };
        },
    };
}
//# sourceMappingURL=searchRecall.js.map