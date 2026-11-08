import { describe, expect, it } from 'vitest';
import { layout3d } from '../scene/layout3d';
import { codeFixture, mixedFixture } from '../testing';
import { fitView, layout2d, layout2dTask, nodeRadius } from './layout2d';

const entries = (l: ReturnType<typeof layout2d>) => [...l.positions.entries()];

describe('layout2d', () => {
    const g = codeFixture();

    it('is deterministic: equal input gives equal output, whatever the input order', () => {
        const a = layout2d('code', g.nodes, g.edges);
        const b = layout2d('code', g.nodes, g.edges);
        const shuffled = layout2d('code', [...g.nodes].reverse(), [...g.edges].reverse());
        expect(entries(b)).toEqual(entries(a));
        expect(entries(shuffled)).toEqual(entries(a));
        expect(shuffled.bands).toEqual(a.bands);
    });

    it('stacks the bands top-down in the 3D plane order', () => {
        const l = layout2d('code', g.nodes, g.edges);
        expect(l.bands.map((b) => b.partition)).toEqual(layout3d('code', g.nodes, g.edges).planes.map((p) => p.partition));
        l.bands.forEach((b, i) => { if (i > 0) expect(b.top).toBeGreaterThanOrEqual(l.bands[i - 1]!.top + l.bands[i - 1]!.height); });
    });

    it('keeps every node inside its partition band and inside the bounds', () => {
        for (const graph of [g, mixedFixture()]) {
            const l = layout2d('r', graph.nodes, graph.edges);
            for (const n of graph.nodes) {
                const [x, y] = l.positions.get(n.ref)!;
                const band = l.bands.find((b) => b.partition === (n.partition ?? ''))!;
                expect(y).toBeGreaterThanOrEqual(band.top);
                expect(y).toBeLessThanOrEqual(band.top + band.height);
                expect(x).toBeGreaterThanOrEqual(l.bounds.minX);
                expect(x).toBeLessThanOrEqual(l.bounds.maxX);
            }
        }
    });

    it('handles an empty graph', () => {
        const l = layout2d('r', [], []);
        expect(l.positions.size).toBe(0);
        expect(fitView(l, 400, 300).w).toBeGreaterThan(0);
    });

    it('sizes a node by importance', () => {
        expect(nodeRadius(1)).toBeGreaterThan(nodeRadius(0.1));
        expect(nodeRadius(5)).toBe(nodeRadius(1));
    });
});

describe('fitView', () => {
    const fixture = codeFixture();
    const l = layout2d('code', fixture.nodes, fixture.edges);

    it('contains the bounds and matches the area aspect ratio', () => {
        const v = fitView(l, 800, 400);
        expect(v.w / v.h).toBeCloseTo(2, 3);
        expect(v.x).toBeLessThanOrEqual(l.bounds.minX);
        expect(v.x + v.w).toBeGreaterThanOrEqual(l.bounds.maxX);
        expect(v.y).toBeLessThanOrEqual(l.bounds.minY);
        expect(v.y + v.h).toBeGreaterThanOrEqual(l.bounds.maxY);
    });

    it('is pure, and falls back to the bounds aspect before the area is measured', () => {
        expect(fitView(l, 800, 400)).toEqual(fitView(l, 800, 400));
        const v = fitView(l, 0, 0);
        expect(v.w).toBeGreaterThan(0);
        expect(v.h).toBeGreaterThan(0);
    });
});

describe('layout2d with a large edge set', () => {
    it('is deterministic with far more edges than springs, and the task equals the one-shot layout', () => {
        const nodes = Array.from({ length: 200 }, (_, i) => ({ ref: `src:r::n${i}.ts` as ReturnType<typeof codeFixture>['nodes'][number]['ref'], kind: 'file' as const, label: `n${i}`, pack: 'code', importance: 0.5, origin: 'extracted' as const }));
        const edges: ReturnType<typeof codeFixture>['edges'] = [];
        for (let i = 0; edges.length < 40_000; i++) edges.push({ from: nodes[i % 200]!.ref as never, to: nodes[(i * 11 + 1) % 200]!.ref as never, kind: 'references', weight: 1, origin: 'extracted' });
        const a = layout2d('big', nodes, edges, { iterations: 3 });
        expect(entries(layout2d('big', nodes, edges, { iterations: 3 }))).toEqual(entries(a));
        const task = layout2dTask('big', nodes, edges, { iterations: 3 });
        while (!task.step());
        expect(entries(task.result())).toEqual(entries(a));
    });
});
