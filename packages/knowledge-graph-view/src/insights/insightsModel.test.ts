import { describe, expect, it } from 'vitest';
import { codeFixture, docsFixture, mixedFixture } from '../testing';
import { insightsOf, METRIC_LENS, type MetricId } from './insightsModel';

const metric = (i: ReturnType<typeof insightsOf>, id: MetricId) => i.metrics.find((m) => m.id === id)!;

describe('insightsOf', () => {
    const g = codeFixture();
    const i = insightsOf(g);

    it('counts the headline metrics from the graph alone', () => {
        const v = (id: MetricId) => metric(i, id).value;
        expect(v('files')).toBe(6);
        expect(v('edges')).toBe(7);
        expect(v('findings')).toBe(5);
        expect([v('errors'), v('warnings'), v('notes')]).toEqual([1, 3, 1]);
        expect(v('cycles')).toBe(1);
        expect(v('violations')).toBe(2);
        expect(v('cloneGroups')).toBe(1);
        expect(v('duplicates')).toBe(2);
        expect(v('unusedFiles')).toBe(1);
        expect(v('stale')).toBe(0);
        const docs = insightsOf(docsFixture());
        expect(metric(docs, 'brokenLinks').value).toBe(1);
        expect(metric(docs, 'stale').value).toBe(1);
        expect(metric(docs, 'sections').value).toBe(1);
    });

    it('maps a metric to the lens that explains it, as data', () => {
        expect(metric(i, 'cycles').lens).toBe('partitions');
        expect(metric(i, 'violations').lens).toBe('partitions');
        expect(metric(i, 'cloneGroups').lens).toBe('duplication');
        expect(metric(i, 'unusedFiles').lens).toBe('unused');
        expect(metric(insightsOf(docsFixture()), 'brokenLinks').lens).toBe('links');
        expect(metric(insightsOf(docsFixture()), 'stale').lens).toBe('knowledge');
        expect(metric(i, 'files').lens).toBeUndefined();
        expect(Object.keys(METRIC_LENS).every((k) => i.metrics.some((m) => m.id === k))).toBe(true);
    });

    it('orders hotspots by value, then by ref', () => {
        // charge and invoice both have two distinct dependants; the tie breaks on ref.
        const charge = g.nodes[2]!.ref;
        expect(i.fanIn[0]).toMatchObject({ id: charge, value: 2 });
        for (const list of [i.fanIn, i.fanOut, i.kinds, i.findingKinds, i.composition.bars]) {
            for (let k = 1; k < list.length; k++) {
                const a = list[k - 1]!, b = list[k]!;
                expect(a.value > b.value || (a.value === b.value && a.id < b.id)).toBe(true);
            }
        }
        // Only distinct dependency pairs count: the duplicate edge and the repeated charge→invoice edge add nothing.
        expect(i.fanOut.reduce((n, b) => n + b.value, 0)).toBe(5);
    });

    it('counts a neighbour once however many edge kinds join it, so the bar equals the list it opens', () => {
        const [a, b] = g.nodes.slice(0, 2).map((n) => n.ref) as [string, string];
        const two = { ...g, edges: [
            { from: a, to: b, kind: 'references', weight: 1, origin: 'extracted' },
            { from: a, to: b, kind: 'imports', weight: 1, origin: 'extracted' },
        ] as typeof g.edges };
        const x = insightsOf(two);
        expect(x.fanIn[0]).toMatchObject({ id: b, value: 1 });
        for (const bar of [...x.fanIn, ...x.fanOut]) expect(bar.refs.length).toBe(bar.value);
    });

    it('measures coupling between partitions, strongest first', () => {
        expect(i.coupling[0]).toMatchObject({ from: 'application', to: 'domain', value: 2 });
        expect(i.coupling.every((c) => c.from !== c.to)).toBe(true);
    });

    it('composes files by partition, else by area, and findings by kind', () => {
        expect(i.composition.by).toBe('partition');
        expect(i.composition.bars.reduce((n, b) => n + b.value, 0)).toBe(6);
        expect(i.findingKinds.map((b) => [b.id, b.value])).toEqual([
            ['partition-violation', 2], ['clone-group', 1], ['cycle', 1], ['unused-file', 1],
        ]);
        const noParts = { ...g, nodes: g.nodes.map(({ partition: _p, ...n }) => n) };
        expect(insightsOf(noParts).composition.by).toBe('area');
    });

    it('is deterministic whatever the input order', () => {
        const m = mixedFixture();
        const shuffled = { ...m, nodes: [...m.nodes].reverse(), edges: [...m.edges].reverse(), findings: [...m.findings].reverse() };
        const a = insightsOf(m), b = insightsOf(shuffled);
        expect(b.metrics).toEqual(a.metrics);
        expect(b.fanIn).toEqual(a.fanIn);
        expect(b.coupling).toEqual(a.coupling);
    });
});
