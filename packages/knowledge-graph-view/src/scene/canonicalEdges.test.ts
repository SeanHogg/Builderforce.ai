import { describe, expect, it } from 'vitest';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { cmp } from '../order';
import { canonicalEdges, canonicalEdgesTask } from './canonicalEdges';
import { rankEdges } from './edgeBudget';
import { layoutTask } from './layout3d';

const KINDS = ['references', 'contains', 'about', 'co-changed'] as const;

function fixture(nodeCount: number, edgeCount: number): { refs: string[]; edges: KEdge[]; nodes: KNode[] } {
    let seed = 7;
    const next = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    const refs = Array.from({ length: nodeCount }, (_, i) => `src:r::f${(i * 7) % nodeCount}.ts`);
    const edges: KEdge[] = Array.from({ length: edgeCount }, () => ({
        // Some ends are not nodes: they must be dropped.
        from: (next() < 0.05 ? 'src:r::ghost.ts' : refs[Math.floor(next() * nodeCount)]!) as KEdge['from'],
        to: refs[Math.floor(next() * nodeCount)]! as KEdge['to'],
        kind: KINDS[Math.floor(next() * KINDS.length)]!, weight: 1, origin: 'extracted',
    }));
    const nodes = refs.map((ref) => ({ ref, kind: 'file', label: ref, pack: 'code', importance: next(), origin: 'extracted' }) as KNode);
    return { refs, edges, nodes };
}

const rankOf = (refs: readonly string[]): Map<string, number> => new Map([...refs].sort(cmp).map((r, i) => [r, i] as const));

/** The definition: by from, then to, then kind, all in string order; ties keep arrival order. */
const naive = (edges: readonly KEdge[], rank: ReadonlyMap<string, number>): KEdge[] =>
    edges.filter((e) => rank.has(e.from) && rank.has(e.to))
        .map((e, i) => ({ e, i }))
        .sort((a, b) => cmp(a.e.from, b.e.from) || cmp(a.e.to, b.e.to) || cmp(a.e.kind, b.e.kind) || a.i - b.i)
        .map((x) => x.e);

describe('canonicalEdges', () => {
    it('equals the by-definition order, drops edges with an unknown end, and keeps ties in arrival order', () => {
        const { refs, edges } = fixture(40, 3000);
        const got = canonicalEdges(edges, rankOf(refs));
        const want = naive(edges, rankOf(refs));
        expect(got.length).toBe(want.length);
        expect(got.every((e, i) => e === want[i])).toBe(true);
    });

    it('is computed ONCE per edges array and node set, whoever asks (ranking, 3D and 2D layouts)', () => {
        const { refs, edges } = fixture(30, 800);
        const a = canonicalEdges(edges, rankOf(refs));
        // A different Map with the same content is the same node set.
        expect(canonicalEdges(edges, rankOf(refs))).toBe(a);
        expect(canonicalEdgesTask(edges, rankOf(refs))).toBe(canonicalEdgesTask(edges, rankOf(refs)));
        expect(canonicalEdgesTask(edges, rankOf(refs)).step()).toBe(true);

        // The ranking and the layout, started on the same edges, advance ONE sort between them.
        const fresh = fixture(30, 800);
        const task = canonicalEdgesTask(fresh.edges, rankOf(fresh.refs));
        rankEdges(fresh.edges, fresh.nodes);
        expect(task.step()).toBe(true); // finished by the ranking, not by this call
        const layout = layoutTask('r', fresh.nodes, fresh.edges);
        while (!layout.step());
        expect(canonicalEdges(fresh.edges, rankOf(fresh.refs))).toBe(task.result());
    });

    it('computes again for another node set', () => {
        const { refs, edges } = fixture(30, 800);
        const all = canonicalEdges(edges, rankOf(refs));
        const fewer = canonicalEdges(edges, rankOf(refs.slice(0, 10)));
        expect(fewer).not.toBe(all);
        expect(fewer.length).toBeLessThan(all.length);
    });

    it('refuses a result before the last step', () => {
        const { refs, edges } = fixture(10, 50);
        const task = canonicalEdgesTask(edges, rankOf(refs));
        expect(() => task.result()).toThrow(/before step/);
    });
});
