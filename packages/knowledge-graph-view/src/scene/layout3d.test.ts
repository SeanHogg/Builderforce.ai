import { describe, expect, it } from 'vitest';
import { layout3d, planeOrder, PLANE_GAP } from './layout3d';
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
