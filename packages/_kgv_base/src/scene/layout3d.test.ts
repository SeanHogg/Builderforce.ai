import { describe, expect, it } from 'vitest';
import type { KEdge, KNode } from '@seanhogg/builderforce-memory/knowledge';
import { layout3d, layoutTask, planeOrder, PLANE_GAP } from './layout3d';
import { LAYOUT_MAX_SPRINGS, layoutSprings } from './layoutSprings';
import { codeFixture, docsFixture, mixedFixture } from '../testing';

const serial = (l: ReturnType<typeof layout3d>) => JSON.stringify({ p: [...l.positions], planes: l.planes });

describe('layout3d', () => {
    it('is deterministic: equal input gives byte-identical coordinates', () => {
        for (const g of [codeFixture(), docsFixture(), mixedFixture()]) {
            expect(serial(layout3d(g.scope.rootId, g.nodes, g.edges))).toBe(serial(layout3d(g.scope.rootId, g.nodes, g.edges)));
        }
    });

    it('does not depend on the order nodes and edges arrive in', () => {
        const g = mixedFixture();
        const a = layout3d('r', g.nodes, g.edges);
        const b = layout3d('r', [...g.nodes].reverse(), [...g.edges].reverse());
        expect(serial(b)).toBe(serial(a));
    });

    it('seeds from the root id', () => {
        const g = docsFixture();
        expect(serial(layout3d('one', g.nodes, g.edges))).not.toBe(serial(layout3d('two', g.nodes, g.edges)));
    });

    it('puts each partition on its own plane, users above what they use', () => {
        const g = codeFixture();
        const order = planeOrder(g.nodes, g.edges);
        expect(order[0]).toBe('presentation');
        const l = layout3d('code', g.nodes, g.edges);
        const yOf = (path: string) => l.positions.get(`src:code::${path}`)![1];
        expect(yOf('app/page.tsx')).toBe(yOf('app/billing.tsx'));
        expect(yOf('app/page.tsx')).toBeGreaterThan(yOf('domain/invoice.ts'));
        expect(new Set(l.planes.map((p) => p.y)).size).toBe(l.planes.length);
        expect(l.planes[0]!.y - l.planes[1]!.y).toBe(PLANE_GAP);
    });

    it('honours an explicit plane order', () => {
        const g = codeFixture();
        expect(planeOrder(g.nodes, g.edges, ['domain', 'presentation'])[0]).toBe('domain');
    });

    it('places every node with finite coordinates', () => {
        const g = mixedFixture();
        const l = layout3d('m', g.nodes, g.edges);
        expect(l.positions.size).toBe(g.nodes.length);
        for (const [, p] of l.positions) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    });
});

describe('layout springs', () => {
    const ref = (i: number) => `src:r::f${i}.ts`;
    const edge = (a: number, b: number, kind = 'references'): KEdge => ({ from: ref(a) as KEdge['from'], to: ref(b) as KEdge['to'], kind, weight: 1, origin: 'extracted' });
    const index = new Map(Array.from({ length: 2000 }, (_, i) => [ref(i), i] as const));

    it('uses every edge under the budget, in the given order, minus self loops and unplaced ends', () => {
        const springs = layoutSprings([edge(1, 2), edge(3, 3), edge(2, 9999), edge(4, 5)], index);
        expect(springs).toEqual([[1, 2], [4, 5]]);
    });

    it('never exceeds LAYOUT_MAX_SPRINGS, prefers non-contains edges, and is deterministic', () => {
        const edges: KEdge[] = [];
        for (let i = 0; edges.length < 50_000; i++) edges.push(edge(i % 2000, (i * 7 + 1) % 2000, i % 5 === 0 ? 'contains' : 'references'));
        const a = layoutSprings(edges, index);
        expect(a.length).toBeLessThanOrEqual(LAYOUT_MAX_SPRINGS);
        expect(layoutSprings(edges, index)).toEqual(a);
        // 40,000 non-contains edges exceed the budget on their own: the springs are a stride sample of them.
        expect(a).toHaveLength(LAYOUT_MAX_SPRINGS);
        const wanted = edges.filter((e) => e.kind !== 'contains').map((e) => [index.get(e.from)!, index.get(e.to)!] as const);
        const pool = new Set(wanted.map(([i, j]) => `${i}>${j}`));
        for (const [i, j] of a) expect(pool.has(`${i}>${j}`)).toBe(true);
    });

    it('fills what the budget has left with a sample of contains edges', () => {
        const edges = [...Array.from({ length: 10 }, (_, i) => edge(i, i + 1)), ...Array.from({ length: 100 }, (_, i) => edge(i, i + 2, 'contains'))];
        const springs = layoutSprings(edges, index, 30);
        expect(springs).toHaveLength(30);
        expect(springs.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => [i, i + 1]));
    });
});

describe('chunked layout', () => {
    it('gives the same coordinates stepped one pass at a time as in one go', () => {
        const g = mixedFixture();
        const whole = layout3d('m', g.nodes, g.edges);
        const task = layoutTask('m', g.nodes, g.edges);
        let steps = 0;
        while (!task.step()) steps++;
        expect(steps).toBeGreaterThan(1);
        expect(serial(task.result())).toBe(serial(whole));
        expect(task.step()).toBe(true); // finished stays finished
    });

    it('refuses to hand out a result before the passes have run', () => {
        const g = mixedFixture();
        const task = layoutTask('m', g.nodes, g.edges);
        expect(() => task.result()).toThrow(/before step/);
        task.step(); // the edge sort alone is not the end either
        expect(() => task.result()).toThrow(/before step/);
    });

    it('lays out a graph with more edges than springs identically twice', () => {
        const nodes: KNode[] = Array.from({ length: 300 }, (_, i) => ({ ref: `src:r::n${i}.ts` as KNode['ref'], kind: 'file', label: `n${i}`, pack: 'code', importance: 0.5, origin: 'extracted', area: `src:r::dir${i % 10}` as NonNullable<KNode['area']> }));
        const edges: KEdge[] = [];
        for (let i = 0; edges.length < 30_000; i++) edges.push({ from: nodes[i % 300]!.ref as KEdge['from'], to: nodes[(i * 13 + 1) % 300]!.ref as KEdge['to'], kind: 'references', weight: 1, origin: 'extracted' });
        expect(serial(layout3d('big', nodes, edges, { iterations: 3 }))).toBe(serial(layout3d('big', nodes, edges, { iterations: 3 })));
    });
});
