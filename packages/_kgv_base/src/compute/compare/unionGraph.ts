/**
 * unionGraph (PRD 43 Part C5): before ∪ after as ONE graph, so ONE MarkSet serves both sides of a compare and every
 * slot stays put (the placement tween then moves marks between the sides). Nodes are keyed by ref and `after`'s copy
 * wins; edges dedupe by (from, to, kind). Order is deterministic and stable: `before`'s nodes first, then the nodes
 * only `after` has, in `after`'s order. Pure and worker-safe.
 */

import type { KEdge, KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { edgeKey } from './edgeKey';

export interface UnionGraph {
    graph: KnowledgeGraph;
    /** Refs only the before graph has (removed): absent on the After side. */
    onlyBefore: ReadonlySet<string>;
    /** Refs only the after graph has (added): absent on the Before side. */
    onlyAfter: ReadonlySet<string>;
}

export function unionGraph(before: KnowledgeGraph, after: KnowledgeGraph): UnionGraph {
    const afterByRef = new Map(after.nodes.map((n) => [n.ref as string, n] as const));
    const beforeRefs = new Set(before.nodes.map((n) => n.ref as string));

    const nodes: KNode[] = [], seen = new Set<string>();
    const onlyBefore = new Set<string>(), onlyAfter = new Set<string>();
    for (const n of before.nodes) {
        if (seen.has(n.ref)) continue;
        seen.add(n.ref);
        const later = afterByRef.get(n.ref);
        if (later) nodes.push(later); else { nodes.push(n); onlyBefore.add(n.ref); }
    }
    for (const n of after.nodes) {
        if (seen.has(n.ref)) continue;
        seen.add(n.ref);
        nodes.push(n);
        if (!beforeRefs.has(n.ref)) onlyAfter.add(n.ref);
    }

    // After's copy wins an edge too: walk after first for the value, but keep before's order for stable slots.
    const edgeOf = new Map<string, KEdge>();
    for (const e of after.edges) if (!edgeOf.has(edgeKey(e))) edgeOf.set(edgeKey(e), e);
    const edges: KEdge[] = [], taken = new Set<string>();
    for (const e of [...before.edges, ...after.edges]) {
        const k = edgeKey(e);
        if (taken.has(k)) continue;
        taken.add(k);
        edges.push(edgeOf.get(k) ?? e);
    }

    const findings = new Map(before.findings.map((f) => [f.id, f] as const));
    for (const f of after.findings) findings.set(f.id, f);

    const graph: KnowledgeGraph = {
        scope: after.scope, nodes, edges, findings: [...findings.values()],
        stats: { ...after.stats, nodes: nodes.length, edges: edges.length },
        ...(after.meta ?? before.meta ? { meta: after.meta ?? before.meta! } : {}),
    };
    return { graph, onlyBefore, onlyAfter };
}

/** The refs absent on a side: a removed ref is absent After, an added one absent Before. */
export function absentOn(u: UnionGraph, side: 'before' | 'after'): ReadonlySet<string> {
    return side === 'before' ? u.onlyAfter : u.onlyBefore;
}
