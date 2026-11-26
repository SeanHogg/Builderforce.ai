import { describe, expect, it, vi } from 'vitest';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { focusGraph } from './graphModel';

const ref = (i: number) => `src:r::f${String(i).padStart(3, '0')}.ts`;
const nodes: KNode[] = Array.from({ length: 200 }, (_, i) => ({ ref: ref(i) as KNode['ref'], kind: 'file', label: ref(i), pack: 'code', importance: 1 - i / 200, origin: 'extracted' }));
const edges: KEdge[] = [];
for (let i = 0; i < 200; i++) for (const d of [1, 7, 40]) if (i + d < 200) edges.push({ from: ref(i) as KEdge['from'], to: ref(i + d) as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' });
const graph = { nodes, edges };

/** What the old implementation returned: the reference the cheap version must agree with. */
function brute(max: number, keep: string[]) {
    const picked = [...nodes].sort((a, b) => b.importance - a.importance).slice(0, max);
    const refs = new Set<string>(picked.map((n) => n.ref));
    for (const n of nodes) if (keep.includes(n.ref) && !refs.has(n.ref)) { picked.push(n); refs.add(n.ref); }
    return { refs, edges: edges.filter((e) => refs.has(e.from) && refs.has(e.to)) };
}

describe('focusGraph', () => {
    it('does not re-sort or re-filter the graph when the selection moves inside the drawn set (same arrays back)', () => {
        const a = focusGraph(graph, 50, [ref(3)]);
        const sort = vi.spyOn(Array.prototype, 'sort');
        const b = focusGraph(graph, 50, [ref(9)]);
        const c = focusGraph(graph, 50, []);
        expect(sort).not.toHaveBeenCalled();
        sort.mockRestore();
        expect(b.nodes).toBe(a.nodes);
        expect(b.edges).toBe(a.edges);
        expect(c.nodes).toBe(a.nodes);
        expect(a.nodes).toHaveLength(50);
    });

    it('adds only the kept node outside the base, with the edges that touch it', () => {
        const base = focusGraph(graph, 50, []);
        const out = focusGraph(graph, 50, [ref(150)]);
        expect(out.nodes).toHaveLength(51);
        expect(out.nodes.slice(0, 50)).toEqual(base.nodes);
        expect(out.edges.length).toBeGreaterThanOrEqual(base.edges.length);
        const want = brute(50, [ref(150)]);
        expect(new Set(out.nodes.map((n) => n.ref))).toEqual(want.refs);
        expect(new Set(out.edges)).toEqual(new Set(want.edges));
    });

    it('agrees with a full recomputation for several kept refs, including one that is not a node', () => {
        const keep = [ref(120), ref(199), 'src:r::missing.ts', ref(2)];
        const out = focusGraph(graph, 30, keep);
        const want = brute(30, keep);
        expect(new Set(out.nodes.map((n) => n.ref))).toEqual(want.refs);
        expect(new Set(out.edges)).toEqual(new Set(want.edges));
        expect(out.edges).toHaveLength(want.edges.length); // no edge twice
    });

    it('returns the whole graph untouched when it is under the cap', () => {
        const out = focusGraph(graph, 500, [ref(1)]);
        expect(out.nodes).toBe(nodes);
        expect(out.edges).toBe(edges);
    });

    it('keeps a separate base per graph and per cap', () => {
        const other = { nodes: [...nodes], edges: [...edges] };
        expect(focusGraph(other, 50, []).nodes).not.toBe(focusGraph(graph, 50, []).nodes);
        expect(focusGraph(graph, 40, []).nodes).toHaveLength(40);
    });
});
