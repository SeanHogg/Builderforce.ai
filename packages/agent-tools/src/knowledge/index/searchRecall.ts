/**
 * Recall over a REMOTE index (docs/design/deterministic-knowledge-index.md, "Consumers") —
 * what a browser host (web, Rovr) answers `knowledge.ask` from: it keeps no local index,
 * so a question is the platform's `search` over a reviewed root plus one hop of the
 * root's server-built graph around the hits (`graph(focus)`). The shape is the local
 * index's `recall`, so the ONE `knowledgeAskExecutor` — its `hitConfidence`, its
 * renderers — answers the same way on every host. Pure: both reads are injected.
 */

import { pathOfRef, type IndexHit, type IndexTier, type KnowledgeGraph, type KNode } from '@seanhogg/builderforce-memory/knowledge';
import type { HitMeta, Recall, RecalledHit } from './contract.js';

/** A one-hop neighbour scores this share of the hit it was reached from. */
export const NEIGHBOUR_SCORE_SHARE = 0.5;

export interface SearchRecallPorts {
    /** The platform's search over the root (`client.search(rootId, q, k)`). */
    search(q: string, k: number): Promise<IndexHit[]>;
    /** The root's graph focused on `refs` (`client.graph(rootId, { focus })`); null when unknown. */
    graph(focus: string[]): Promise<KnowledgeGraph | null>;
}

const metaOf = (node: KNode | undefined): HitMeta | undefined =>
    node ? { kind: node.kind, label: node.label, ...(node.partition ? { partition: node.partition } : {}) } : undefined;

function recalled(hit: IndexHit, node: KNode | undefined, expanded: boolean): RecalledHit {
    const path = pathOfRef(hit.id);
    const meta = metaOf(node);
    return { ...hit, ...(path ? { path } : {}), ...(meta ? { meta } : {}), ...(expanded ? { expanded: true } : {}) };
}

/** `recall` over a remote search and graph — the `knowledge.ask` host for a browser. */
export function searchRecall(ports: SearchRecallPorts): { recall(q: string, opts?: { k?: number }): Promise<Recall> } {
    return {
        async recall(q, opts = {}) {
            const k = opts.k ?? 8;
            const hits = await ports.search(q, k);
            const tiers = [...new Set(hits.map((h) => h.tier))] as IndexTier[];
            if (hits.length === 0) return { hits: [], tiers, digest: '' };
            const graph = await ports.graph(hits.map((h) => h.id)).catch(() => null);
            const nodes = new Map((graph?.nodes ?? []).map((n) => [n.ref as string, n] as const));
            const own = new Set(hits.map((h) => h.id));
            const out: RecalledHit[] = hits.map((h) => recalled(h, nodes.get(h.id), false));
            const reached = new Map<string, RecalledHit>();
            for (const hit of hits) {
                for (const edge of graph?.edges ?? []) {
                    const other = edge.from === hit.id ? edge.to : edge.to === hit.id ? edge.from : undefined;
                    if (!other || own.has(other)) continue;
                    const score = hit.score * Math.min(1, Math.max(0, edge.weight)) * NEIGHBOUR_SCORE_SHARE;
                    const prior = reached.get(other);
                    if (!prior || prior.score < score) reached.set(other, recalled({ id: other, score, tier: hit.tier }, nodes.get(other), true));
                }
            }
            const neighbours = [...reached.values()].sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
            return { hits: [...out, ...neighbours].slice(0, k * 2), tiers, digest: graph?.scope.digest ?? '' };
        },
    };
}
