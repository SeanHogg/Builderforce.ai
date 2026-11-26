/**
 * diffGraphs (PRD 43 Part C5): what differs between two graphs, by node ref. Pure and worker-safe; the compare bar, the
 * union MarkSet and `paintMarks`' diff override all read this one shape.
 *
 * `changed` = a node in both whose badges, findings, `sourceHash` or set of incident edges differ. Every list is sorted,
 * so the same two graphs always give the same diff.
 */

import type { KEdge, KnowledgeGraph, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../../order';

export type DiffKind = 'added' | 'changed' | 'removed';

export interface GraphDiff {
    added: string[];
    removed: string[];
    changed: string[];
    edgesAdded: [string, string][];
    edgesRemoved: [string, string][];
}

const SEP = '\u0000';
const edgeKey = (e: Pick<KEdge, 'from' | 'to' | 'kind'>): string => `${e.from}${SEP}${e.to}${SEP}${e.kind}`;

/** A node's badges as one comparable string (keys sorted, so insertion order never reads as a change). */
function badgeKey(n: KNode): string {
    const b = n.badges;
    if (!b) return '';
    return Object.keys(b).sort(cmp).map((k) => `${k}=${String(b[k])}`).join(SEP);
}

/** Per node ref: the sorted keys of the edges touching it, and of the findings naming it. */
function incidence(g: KnowledgeGraph): { edges: Map<string, string[]>; findings: Map<string, string[]> } {
    const edges = new Map<string, string[]>(), findings = new Map<string, string[]>();
    const push = (m: Map<string, string[]>, ref: string, key: string): void => {
        const held = m.get(ref);
        if (held) held.push(key); else m.set(ref, [key]);
    };
    for (const e of g.edges) {
        const key = edgeKey(e);
        push(edges, e.from, key);
        if (e.to !== e.from) push(edges, e.to, key);
    }
    for (const f of g.findings) for (const ref of new Set(f.nodes)) push(findings, ref, f.id);
    for (const m of [edges, findings]) for (const list of m.values()) list.sort(cmp);
    return { edges, findings };
}

const same = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => {
    const x = a ?? [], y = b ?? [];
    return x.length === y.length && x.every((v, i) => v === y[i]);
};

const pairs = (keys: Iterable<string>): [string, string][] => {
    const seen = new Set<string>(), out: [string, string][] = [];
    for (const k of keys) {
        const [from, to] = k.split(SEP) as [string, string];
        const pair = `${from}${SEP}${to}`;
        if (!seen.has(pair)) { seen.add(pair); out.push([from, to]); }
    }
    return out.sort((p, q) => cmp(p[0], q[0]) || cmp(p[1], q[1]));
};

export function diffGraphs(before: KnowledgeGraph, after: KnowledgeGraph): GraphDiff {
    const was = new Map(before.nodes.map((n) => [n.ref as string, n] as const));
    const now = new Map(after.nodes.map((n) => [n.ref as string, n] as const));
    const added = [...now.keys()].filter((r) => !was.has(r)).sort(cmp);
    const removed = [...was.keys()].filter((r) => !now.has(r)).sort(cmp);

    const a = incidence(before), b = incidence(after);
    const changed: string[] = [];
    for (const [ref, n] of now) {
        const old = was.get(ref);
        if (!old) continue;
        if (badgeKey(old) !== badgeKey(n) || (old.sourceHash ?? '') !== (n.sourceHash ?? '')
            || !same(a.findings.get(ref), b.findings.get(ref)) || !same(a.edges.get(ref), b.edges.get(ref))) changed.push(ref);
    }
    changed.sort(cmp);

    const beforeEdges = new Set(before.edges.map(edgeKey)), afterEdges = new Set(after.edges.map(edgeKey));
    return {
        added, removed, changed,
        edgesAdded: pairs([...afterEdges].filter((k) => !beforeEdges.has(k))),
        edgesRemoved: pairs([...beforeEdges].filter((k) => !afterEdges.has(k))),
    };
}

/** The refs a side paints: the before side shows what was removed (and changed), the after side what was added (and changed). */
export function diffKindOf(diff: GraphDiff, side: 'before' | 'after'): Map<string, DiffKind> {
    const out = new Map<string, DiffKind>();
    for (const r of side === 'before' ? diff.removed : diff.added) out.set(r, side === 'before' ? 'removed' : 'added');
    for (const r of diff.changed) out.set(r, 'changed');
    return out;
}
