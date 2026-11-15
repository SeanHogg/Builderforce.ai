import { describe, expect, it } from 'vitest';
import type { KEdge, KNode, KnowledgeGraph, NodeRef } from '@seanhogg/builderforce-memory/knowledge';
import { applyGraphPatch } from './graphPatch';
import type { KnowledgeGraphPatch } from './types';

const ROOT = 'r';
const file = (p: string): NodeRef => `src:${ROOT}::${p}` as NodeRef;
const node = (p: string, partition = 'presentation'): KNode => ({
    ref: file(p), kind: 'file', label: p, pack: 'code', partition, importance: 0.5, origin: 'extracted',
});
const edge = (from: string, to: string): KEdge => ({ from: file(from), to: file(to), kind: 'references', weight: 1, origin: 'extracted' });

const graph = (): KnowledgeGraph => ({
    scope: { rootId: ROOT, packs: ['code'], digest: 'd' },
    nodes: [node('a.ts'), node('b.ts'), node('gone.ts')],
    edges: [edge('a.ts', 'b.ts'), edge('a.ts', 'gone.ts')],
    findings: [],
    stats: { sources: 1, nodes: 3, edges: 2, stale: 0, truncated: false },
});

const patch = (over: Partial<KnowledgeGraphPatch> = {}): KnowledgeGraphPatch => ({
    rootId: ROOT,
    files: [],
    removedNodes: [],
    upsertNodes: [],
    removedEdges: [],
    upsertEdges: [],
    stale: [],
    changed: [],
    ...over,
});

describe('applyGraphPatch', () => {
    it('removes the named nodes and their edges, keeps the rest', () => {
        const out = applyGraphPatch(graph(), patch({ removedNodes: [file('gone.ts')] }));
        expect(out.nodes.map((n) => n.ref)).toEqual([file('a.ts'), file('b.ts')]);
        expect(out.edges.map((e) => `${e.from}->${e.to}`)).toEqual([`${file('a.ts')}->${file('b.ts')}`]);
        expect(out.stats.nodes).toBe(2);
        expect(out.stats.edges).toBe(1);
    });

    it('upserts a node by ref and an edge by (from,to,kind), replacing on key match', () => {
        const replaced = { ...node('a.ts'), importance: 0.9 };
        const out = applyGraphPatch(
            graph(),
            patch({ upsertNodes: [replaced], upsertEdges: [edge('b.ts', 'a.ts')] }),
        );
        expect(out.nodes.find((n) => n.ref === file('a.ts'))?.importance).toBe(0.9);
        expect(out.edges.some((e) => e.from === file('b.ts') && e.to === file('a.ts'))).toBe(true);
        expect(out.edges.filter((e) => e.from === file('a.ts') && e.to === file('b.ts'))).toHaveLength(1);
    });

    it('flags stale refs and lets the host decorate the result', () => {
        const out = applyGraphPatch(
            graph(),
            patch({ stale: [file('b.ts')] }),
            (g) => ({ ...g, stats: { ...g.stats, sources: 99 } }),
        );
        expect(out.nodes.find((n) => n.ref === file('b.ts'))?.stale).toBe(true);
        expect(out.stats.stale).toBe(1);
        expect(out.stats.sources).toBe(99);
    });
});
