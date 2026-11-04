// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES } from '../lenses';
import { codeFixture } from '../testing';
import { Graph2D, LABELLED_NODES } from './Graph2D';

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

    it('offers zoom controls and dims nodes the lens does not highlight', async () => {
        const { container } = mount({ lens: LENSES.duplication });
        await ready(container);
        expect(screen.getByRole('button', { name: L.zoomIn })).toBeTruthy();
        expect(screen.getByRole('button', { name: L.zoomReset })).toBeTruthy();
        const opacities = [...container.querySelectorAll('circle[data-dot]')].map((c) => c.getAttribute('opacity'));
        expect(opacities).toContain('0.35');
        expect(opacities).toContain('1');
        expect(LABELLED_NODES).toBe(25);
    });
});
