// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES } from '../lenses';
import { ZoomProvider, type ZoomApi } from '../surface/zoom';
import { codeFixture } from '../testing';
import { Graph2D, LABELLED_NODES } from './Graph2D';
import { MAX_DRAWN_EDGES } from '../scene/edgeBudget';

const g = codeFixture();

function mount(props: Partial<Parameters<typeof Graph2D>[0]> = {}) {
    const onSelect = vi.fn();
    const utils = render(
        <div style={{ height: 400 }}>
            <Graph2D
                rootId="code" nodes={g.nodes} edges={g.edges} lens={LENSES.structure} selected={null} onSelect={onSelect}
                planeLabel={(p) => p || L.partitionNone} labels={L} label={L.regionLabel} {...props}
            />
        </div>,
    );
    return { onSelect, ...utils };
}

const ready = (c: HTMLElement) => waitFor(() => expect(c.querySelector('svg')).toBeTruthy());

describe('Graph2D', () => {
    it('draws a circle per node once the idle layout lands, with a band per partition', async () => {
        const { container } = mount();
        await ready(container);
        expect(container.querySelectorAll('g[data-id]')).toHaveLength(g.nodes.length);
        expect(container.querySelectorAll('[data-band]')).toHaveLength(4);
        expect(container.querySelector('title')?.textContent).toBe(L.regionLabel);
    });

    it('draws one edge path per tone bucket, edges first', async () => {
        const { container } = mount();
        await ready(container);
        const buckets = [...container.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge'));
        expect(buckets).toEqual([...buckets].sort());
        expect(buckets).toContain('violation');
        expect(buckets).toContain('cycle');
        const svg = container.querySelector('svg')!;
        const firstEdge = svg.querySelector('path[data-edge]')!;
        const firstNode = svg.querySelector('g[data-id]')!;
        expect(firstEdge.compareDocumentPosition(firstNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('names each node by label and kind, and selects on click and on Enter', async () => {
        const { onSelect } = mount();
        const page = await screen.findByRole('button', { name: 'app/page.tsx, File' });
        fireEvent.click(page);
        expect(onSelect).toHaveBeenCalledWith(g.nodes[0]!.ref);
        fireEvent.keyDown(page, { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledTimes(2);
    });

    it('walks nodes in importance order', async () => {
        const { container } = mount();
        await ready(container);
        const order = [...container.querySelectorAll('g[data-id]')].map((c) => c.getAttribute('data-id'));
        const expected = [...g.nodes].sort((a, b) => b.importance - a.importance || (a.ref < b.ref ? -1 : 1)).map((n) => n.ref);
        expect(order).toEqual(expected);
    });

    it('rings the selected node and emphasises its incident edges', async () => {
        const { container } = mount({ selected: g.nodes[3]!.ref });
        await ready(container);
        expect(container.querySelectorAll('[data-selected="true"]')).toHaveLength(1);
        expect(container.querySelectorAll('path[data-incident]').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: 'domain/invoice.ts, File' }).getAttribute('aria-pressed')).toBe('true');
    });

    it('shows no ring and no incident edges without a selection', async () => {
        const { container } = mount();
        await ready(container);
        expect(container.querySelector('[data-selected]')).toBeNull();
        expect(container.querySelector('path[data-incident]')).toBeNull();
    });

    it('registers its zoom with the scene overlay (no buttons of its own) and dims nodes the lens does not highlight', async () => {
        let api: ZoomApi | null = null;
        const host = { register: (a: ZoomApi) => { api = a; }, unregister: (a: ZoomApi) => { if (api === a) api = null; } };
        const { container } = render(
            <ZoomProvider host={host}>
                <div style={{ height: 400 }}>
                    <Graph2D
                        rootId="code" nodes={g.nodes} edges={g.edges} lens={LENSES.duplication} selected={null} onSelect={vi.fn()}
                        planeLabel={(p) => p || L.partitionNone} labels={L} label={L.regionLabel}
                    />
                </div>
            </ZoomProvider>,
        );
        await ready(container);
        expect(screen.queryByRole('button', { name: L.zoomIn })).toBeNull();
        expect(api).not.toBeNull();
        const width = () => Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
        const fitted = width();
        act(() => api!.zoomIn());
        expect(width()).toBeLessThan(fitted);
        act(() => api!.fit());
        expect(width()).toBe(fitted);
        const opacities = [...container.querySelectorAll('circle[data-dot]')].map((c) => c.getAttribute('opacity'));
        expect(opacities).toContain('0.35');
        expect(opacities).toContain('1');
        expect(LABELLED_NODES).toBe(25);
    });
});

describe('Graph2D link budget', () => {
    // 300 nodes, every pair linked: 44,850 edges against a 15,000 budget.
    const ref = (i: number) => `src:big::f${String(i).padStart(3, '0')}.ts`;
    const nodes = Array.from({ length: 300 }, (_, i) => ({ ref: ref(i) as typeof g.nodes[number]['ref'], kind: 'file' as const, label: `f${i}`, pack: 'code', importance: 1 - i / 300, origin: 'extracted' as const }));
    const edges: typeof g.edges = [];
    for (let i = 0; i < 300; i++) for (let j = i + 1; j < 300; j++) edges.push({ from: ref(i) as typeof g.edges[number]['from'], to: ref(j) as typeof g.edges[number]['to'], kind: 'references', weight: 1, origin: 'extracted' });
    const drawnSegments = (c: HTMLElement) => [...c.querySelectorAll('path[data-edge]')].reduce((n, p) => n + (p.getAttribute('d')!.match(/M/g)?.length ?? 0), 0);

    it('draws at most MAX_DRAWN_EDGES links, the same ones every time', async () => {
        const first = mount({ nodes, edges });
        await waitFor(() => expect(first.container.querySelector('path[data-edge]')).toBeTruthy(), { timeout: 10_000 });
        const a = drawnSegments(first.container);
        expect(a).toBe(MAX_DRAWN_EDGES);
        const d = [...first.container.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('d'));
        first.unmount();
        const second = mount({ nodes, edges });
        await waitFor(() => expect(second.container.querySelector('path[data-edge]')).toBeTruthy(), { timeout: 10_000 });
        expect([...second.container.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('d'))).toEqual(d);
    }, 30_000);

    it('always draws every link of the selected node, even past the budget', async () => {
        const { container } = mount({ nodes, edges, selected: ref(299) });
        await waitFor(() => expect(container.querySelector('path[data-incident]')).toBeTruthy(), { timeout: 10_000 });
        const incident = [...container.querySelectorAll('path[data-incident]')].reduce((n, p) => n + (p.getAttribute('d')!.match(/M/g)?.length ?? 0), 0);
        expect(incident).toBe(299);
    }, 30_000);

    it('keeps the base edge layer when the selection moves: only the incident overlay changes', async () => {
        const first = mount({ nodes, edges, selected: ref(10) });
        // The base layer (15,000 links, built on idle) and the incident overlay (built at once) land at different times: wait for BOTH before comparing.
        await waitFor(() => {
            expect(first.container.querySelector('path[data-incident]')).toBeTruthy();
            expect(first.container.querySelector('path[data-edge]')).toBeTruthy();
        }, { timeout: 10_000 });
        const baseOf = (c: HTMLElement) => [...c.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('d')).join('|');
        const incidentOf = (c: HTMLElement) => [...c.querySelectorAll('path[data-incident]')].map((p) => p.getAttribute('d')).join('|');
        const base = baseOf(first.container);
        const overlay = incidentOf(first.container);
        first.rerender(
            <div style={{ height: 400 }}>
                <Graph2D
                    rootId="code" nodes={nodes} edges={edges} lens={LENSES.structure} selected={ref(20)} onSelect={() => undefined}
                    planeLabel={(p) => p || L.partitionNone} labels={L} label={L.regionLabel}
                />
            </div>,
        );
        await waitFor(() => expect(incidentOf(first.container)).not.toBe(overlay), { timeout: 10_000 });
        expect(baseOf(first.container)).toBe(base);
    }, 30_000);
});

describe('Graph2D while laying out', () => {
    it('shows a localized "laying out" line instead of a blank canvas, then the graph', async () => {
        const { container, getByTestId } = mount();
        expect(getByTestId('kg-laying-out').textContent).toBe(L.surface.scene.layingOut);
        await ready(container);
        expect(container.querySelector('[data-testid="kg-laying-out"]')).toBeNull();
    });

    it('re-renders only the nodes whose state changed when the selection moves', async () => {
        const { container, rerender } = mount();
        await ready(container);
        const dots = () => [...container.querySelectorAll('g[data-id]')];
        const before = dots();
        const [a, b] = [g.nodes[0]!.ref, g.nodes[1]!.ref];
        rerender(
            <div style={{ height: 400 }}>
                <Graph2D
                    rootId="code" nodes={g.nodes} edges={g.edges} lens={LENSES.structure} selected={a} onSelect={() => undefined}
                    planeLabel={(p) => p || L.partitionNone} labels={L} label={L.regionLabel}
                />
            </div>,
        );
        await waitFor(() => expect(container.querySelector(`g[data-id="${a}"]`)?.getAttribute('aria-pressed')).toBe('true'));
        // The nodes keep their elements (no remount); only the pressed state moved.
        expect(dots().every((el, i) => el === before[i])).toBe(true);
        expect(container.querySelector(`g[data-id="${b}"]`)?.getAttribute('aria-pressed')).toBe('false');
    });
});
