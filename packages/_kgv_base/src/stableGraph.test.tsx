// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { focusGraph } from './graphModel';
import { sameGraph, useStableGraph } from './stableGraph';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';

const ref = (i: number) => `src:r::f${String(i).padStart(4, '0')}.ts`;
const nodes: KNode[] = Array.from({ length: 50 }, (_, i) => ({ ref: ref(i) as KNode['ref'], kind: 'file', label: ref(i), pack: 'code', importance: 1 - i / 50, origin: 'extracted' }));
const edges: KEdge[] = Array.from({ length: 49 }, (_, i) => ({ from: ref(i) as KEdge['from'], to: ref(i + 1) as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' }));
const graph = { nodes, edges };

describe('stable drawn graph', () => {
    it('focusGraph hands back its cached base arrays while the selection stays inside the top set, and new arrays only when it adds a node', () => {
        const a = focusGraph(graph, 20, [ref(3)]);
        const b = focusGraph(graph, 20, [ref(4)]);
        expect(b.nodes).toBe(a.nodes); // nodes 3 and 4 are both inside the top 20: the base itself, no copy
        const c = focusGraph(graph, 20, [ref(40)]);
        expect(c.nodes).not.toBe(a.nodes);
        expect(c.nodes).toHaveLength(21);
    });

    it('sameGraph compares content, not identity: equal copies are the same graph', () => {
        const a = focusGraph(graph, 20, []);
        expect(sameGraph(a, { nodes: [...a.nodes], edges: [...a.edges] })).toBe(true);
        expect(sameGraph(a, { nodes: a.nodes.slice(1), edges: a.edges })).toBe(false);
    });

    it('keeps the identity of the arrays while the selection stays inside the drawn set', () => {
        const { result, rerender } = renderHook(({ sel }) => useStableGraph(focusGraph(graph, 20, [sel])), { initialProps: { sel: ref(3) } });
        const first = result.current;
        rerender({ sel: ref(7) });
        expect(result.current).toBe(first);
        expect(result.current.nodes).toBe(first.nodes);
        expect(result.current.edges).toBe(first.edges);
    });

    it('changes identity when the selection really adds a node', () => {
        const { result, rerender } = renderHook(({ sel }) => useStableGraph(focusGraph(graph, 20, [sel])), { initialProps: { sel: ref(3) } });
        const first = result.current;
        rerender({ sel: ref(40) }); // outside the top 20: it is brought in
        expect(result.current).not.toBe(first);
        expect(result.current.nodes).toHaveLength(21);
    });
});
