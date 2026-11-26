import { describe, expect, it } from 'vitest';
import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../testing';
import { absentOn, unionGraph } from './unionGraph';

const ref = (path: string) => `src:sys::${path}`;
const file = (path: string, importance = 0.5): KNode =>
    ({ ref: ref(path) as KNode['ref'], kind: 'file', label: path, pack: 'code', importance, origin: 'extracted' });
const edge = (from: string, to: string, kind = 'references'): KEdge =>
    ({ from: ref(from) as KEdge['from'], to: ref(to) as KEdge['to'], kind, weight: 1, origin: 'extracted' });

describe('unionGraph (PRD 43 C5)', () => {
    const base = surfaceFixture();
    const before: KnowledgeGraph = { ...base, nodes: [file('a.ts'), file('b.ts'), file('c.ts')], edges: [edge('a.ts', 'b.ts'), edge('b.ts', 'c.ts')], findings: [] };
    const after: KnowledgeGraph = {
        ...base, nodes: [file('d.ts'), file('c.ts', 0.9), file('a.ts')], findings: [],
        edges: [edge('a.ts', 'b.ts'), edge('a.ts', 'd.ts'), edge('d.ts', 'c.ts', 'calls')],
    };

    it("keeps before's node order, then the after-only nodes in after's order", () => {
        const u = unionGraph(before, after);
        expect(u.graph.nodes.map((n) => n.ref)).toEqual(['a.ts', 'b.ts', 'c.ts', 'd.ts'].map(ref));
    });

    it("names what only one side has, and after's copy wins a node held by both", () => {
        const u = unionGraph(before, after);
        expect([...u.onlyBefore]).toEqual([ref('b.ts')]);
        expect([...u.onlyAfter]).toEqual([ref('d.ts')]);
        expect(u.graph.nodes.find((n) => n.ref === ref('c.ts'))!.importance).toBe(0.9);
        expect([...absentOn(u, 'before')]).toEqual([ref('d.ts')]);
        expect([...absentOn(u, 'after')]).toEqual([ref('b.ts')]);
    });

    it('dedupes edges by (from, to, kind): a repeated edge is one, a different kind is another', () => {
        const u = unionGraph(before, after);
        expect(u.graph.edges.map((e) => `${e.from.slice(9)}>${e.to.slice(9)}:${e.kind}`))
            .toEqual(['a.ts>b.ts:references', 'b.ts>c.ts:references', 'a.ts>d.ts:references', 'd.ts>c.ts:calls']);
        expect(u.graph.stats).toMatchObject({ nodes: 4, edges: 4 });
    });

    it('slots are stable: the union of (before, after) starts with the union of (before, before)', () => {
        const same = unionGraph(before, before).graph.nodes.map((n) => n.ref);
        expect(unionGraph(before, after).graph.nodes.map((n) => n.ref).slice(0, same.length)).toEqual(same);
    });

    it('is deterministic', () => {
        expect(unionGraph(before, after)).toEqual(unionGraph(before, after));
    });
});
