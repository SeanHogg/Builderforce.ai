// @vitest-environment jsdom
/** The view modes (graph, 3D, map, list) and the insights aside that shows in every one. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { codeFixture, fixtureSource, mixedFixture } from './testing';

vi.mock('./scene/GraphScene', () => ({ default: () => <div data-testid="kg-scene" /> }));
afterEach(() => vi.restoreAllMocks());

async function mount(graph: KnowledgeGraph = codeFixture()) {
    render(<div style={{ height: 600 }}><KnowledgeGraphView source={fixtureSource([graph])} /></div>);
    // A cheap DOM wait: a role query over the whole view can outlast the idle layout's timer.
    await waitFor(() => expect(document.querySelector('[data-testid="kg-graph2d"] [data-id]')).not.toBeNull());
}
const modes = () => within(screen.getByRole('group', { name: L.viewModesLabel }));
const insights = () => within(screen.getByTestId('kg-insights'));

describe('view modes', () => {
    it('opens on the 2D graph, not the list, when there is no WebGL', async () => {
        await mount();
        expect(screen.queryByTestId('kg-list')).toBeNull();
        expect(screen.getAllByRole('button', { name: /, File$/ }).length).toBeGreaterThan(0);
        expect(modes().getByRole('button', { name: L.viewGraph }).getAttribute('aria-pressed')).toBe('true');
        expect(modes().queryByRole('button', { name: L.view3d })).toBeNull();
        expect(modes().getByRole('button', { name: L.viewMap })).toBeTruthy();
        expect(modes().getByRole('button', { name: L.viewList })).toBeTruthy();
    });

    it('shows the insights aside in every mode, with the lens panel', async () => {
        await mount();
        for (const name of [L.viewGraph, L.viewMap, L.viewList]) {
            fireEvent.click(modes().getByRole('button', { name }));
            expect(screen.getByTestId('kg-insights'), name).toBeTruthy();
            expect(screen.getByText(L.lensHints.structure), name).toBeTruthy();
        }
        expect(screen.getByTestId('kg-list')).toBeTruthy();
    });

    it('draws the folder mind map', async () => {
        await mount();
        fireEvent.click(modes().getByRole('button', { name: L.viewMap }));
        expect(await screen.findByTestId('kg-map')).toBeTruthy();
        expect(screen.queryByTestId('kg-graph2d')).toBeNull();
    });

    it('offers 3D when WebGL exists, even with reduced motion, and does not default to it', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({})) as never);
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        try {
            await mount();
            fireEvent.click(await modes().findByRole('button', { name: L.view3d }));
            expect(await screen.findByTestId('kg-scene')).toBeTruthy();
            expect(screen.getByTestId('kg-insights')).toBeTruthy();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('insights', () => {
    it('shows the metric tiles and opens the lens that explains one', async () => {
        await mount(mixedFixture());
        const tile = insights().getByText(L.metrics.cycles!).closest('button')!;
        fireEvent.click(tile);
        const nav = within(screen.getByRole('navigation', { name: L.lensesLabel }));
        await waitFor(() => expect(nav.getByRole('button', { name: L.lenses.partitions }).getAttribute('aria-pressed')).toBe('true'));
    });

    it('draws no tile for something the graph has none of', async () => {
        await mount(codeFixture());
        // A code graph has no broken links to count, so that tile is not drawn.
        expect(screen.getByTestId('kg-insights').querySelector('button[data-metric="brokenLinks"]')).toBeNull();
    });

    it('draws the charts and focuses a bar\'s nodes', async () => {
        await mount();
        const bar = insights().getByRole('button', { name: `${L.legend.file}: 6` });
        fireEvent.click(bar);
        await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
        expect(insights().getByText(L.chartKinds)).toBeTruthy();
    });
});
