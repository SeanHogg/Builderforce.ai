// @vitest-environment jsdom
/** The view modes (graph, 3D, map, list) and the insights aside that shows in every one. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { KnowledgeGraphView } from './KnowledgeGraphView';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from './labels';
import { codeFixture, fixtureSource, mixedFixture } from './testing';
import { lensIsPicked, openDetails as openDetailsOf } from './testPicks';
import { StageFactoryContext } from './stage/host/StageFactoryContext';
import { createNoopStage } from './stage/renderer';

// The view draws every placement camera (Graph/Map/3D/transit) through the lazy three.js StageHost
// (PRD 43 B1a). In jsdom the real WebGL factory declines and the scene falls back to the List, so the
// camera switcher and scene these tests assert on never mount. Provide the no-op stage factory through
// the real context — the same port stageCard.test.tsx drives — so the stage host mounts and the whole
// view renders. No module mocks: they do not intercept reliably in this whole-view graph.
afterEach(() => vi.restoreAllMocks());

async function mount(graph: KnowledgeGraph = codeFixture()) {
    render(
        <StageFactoryContext.Provider value={() => createNoopStage()}>
            <div style={{ height: 600 }}><KnowledgeGraphView source={fixtureSource([graph])} /></div>
        </StageFactoryContext.Provider>,
    );
    // The scene's "a graph is loaded and drawn" gate: the stage host mounts only once a real graph paints.
    await waitFor(() => expect(document.querySelector('[data-stage-host]')).toBeTruthy());
}
// The View group is a segmented radio group; Insights and the Lens panel sit in the Act rail's collapsed Details section (in the DOM, hidden).
const modes = () => within(screen.getByRole('radiogroup', { name: L.viewModesLabel }));
const insights = () => within(screen.getByTestId('kg-insights'));
const openDetails = () => openDetailsOf({ fireEvent });
// The Graph camera draws the graph on the stage: every shown node is an a11y proxy button (data-id "node:<ref>").
const graphNodeProxies = () => document.querySelectorAll('[data-stage-proxies] [data-id^="node:"]');
const stageCamera = () => document.querySelector('[data-stage-host]')?.getAttribute('data-stage-camera');

async function graphNodesSettled(): Promise<void> {
    // Proxies land after the MarkSet and placement resolve: wait until at least one node shows.
    await waitFor(() => expect(graphNodeProxies().length).toBeGreaterThan(0));
}

describe('view modes', () => {
    it('opens on the 2D graph, not the list, when there is no WebGL', async () => {
        await mount();
        expect(screen.queryByTestId('kg-list')).toBeNull();
        await graphNodesSettled();
        expect(modes().getByRole('radio', { name: L.viewGraph }).getAttribute('aria-checked')).toBe('true');
        expect(modes().queryByRole('radio', { name: L.view3d })).toBeNull();
        expect(modes().getByRole('radio', { name: L.viewMap })).toBeTruthy();
        expect(modes().getByRole('radio', { name: L.viewList })).toBeTruthy();
    });

    it('shows the insights aside in every mode, with the lens panel', async () => {
        await mount();
        for (const name of [L.viewGraph, L.viewMap, L.viewList]) {
            fireEvent.click(modes().getByRole('radio', { name }));
            expect(screen.getByTestId('kg-insights'), name).toBeTruthy();
            expect(screen.getByText(L.lensHints.structure), name).toBeTruthy();
        }
        expect(screen.getByTestId('kg-list')).toBeTruthy();
    });

    it('draws the folder mind map', async () => {
        await mount();
        fireEvent.click(modes().getByRole('radio', { name: L.viewMap }));
        // The Mind map camera is the `mind` placement of the one stage.
        await waitFor(() => expect(stageCamera()).toBe('mind'));
        expect(stageCamera()).not.toBe('graph');
    });

    it('offers 3D when WebGL exists, even with reduced motion, and does not default to it', async () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({})) as never);
        vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined }));
        try {
            await mount();
            // The 3D camera is offered (WebGL exists) but the Graph is still the default.
            fireEvent.click(await modes().findByRole('radio', { name: L.view3d }));
            await waitFor(() => expect(stageCamera()).toBe('3d'));
            expect(screen.getByTestId('kg-insights')).toBeTruthy();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('insights', () => {
    it('shows the metric tiles and opens the lens that explains one', async () => {
        await mount(mixedFixture());
        openDetails();
        const tile = insights().getByText(L.metrics.cycles!).closest('button')!;
        fireEvent.click(tile);
        await waitFor(() => expect(lensIsPicked({ fireEvent }, L, 'partitions')).toBe(true));
    });

    it('draws no tile for something the graph has none of', async () => {
        await mount(codeFixture());
        // A code graph has no broken links to count, so that tile is not drawn.
        expect(screen.getByTestId('kg-insights').querySelector('button[data-metric="brokenLinks"]')).toBeNull();
    });

    it('draws the charts and focuses a bar\'s nodes', async () => {
        await mount();
        openDetails();
        const bar = insights().getByRole('button', { name: `${L.legend.file}: 6` });
        fireEvent.click(bar);
        await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
        expect(insights().getByText(L.chartKinds)).toBeTruthy();
    });
});
