// @vitest-environment jsdom
/** The architecture cameras (4+1, Style, Features): drawn over the surface fixture, hidden on a graph with no source code. */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../labels';
import { LENSES } from '../lenses';
import { docsFixture, surfaceFixture } from '../testing';
import type { ViewMode } from '../types';
import { ViewSurface } from '../ViewSurface';
import { CAMERAS } from './cameras';
import { useSurface } from './useSurface';

vi.mock('../scene/GraphScene', () => ({ default: () => null }));

const env = { webgl: false, reducedMotion: true, hasLines: true, compact: false };
const ARCH: ViewMode[] = ['4plus1', 'style', 'features'];

function mount(mode: ViewMode, graph: KnowledgeGraph = surfaceFixture(), onSelect = vi.fn()) {
    function Harness() {
        const surface = useSurface(graph, null);
        return (
            <ViewSurface
                mode={mode} graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys"
                selected={null} focus={[]} reducedMotion surface={surface} onSelect={onSelect} onShow={vi.fn()}
            />
        );
    }
    render(<Harness />);
    return onSelect;
}

describe('the architecture cameras', () => {
    it('are offered for code and hidden for a graph with no source files', () => {
        const ids = (g: KnowledgeGraph) => CAMERAS.filter((c) => ARCH.includes(c.id) && c.available(g, env)).map((c) => c.id);
        expect(ids(surfaceFixture())).toEqual(ARCH);
        expect(ids(docsFixture())).toEqual([]);
    });

    it('4+1 switches between its five views and names each', () => {
        mount('4plus1');
        const views = within(screen.getByRole('radiogroup', { name: L.surface.fourPlusOne.viewsLabel }));
        expect(views.getAllByRole('radio').map((r) => r.textContent)).toEqual(Object.values(L.surface.fourPlusOne.views));
        expect(screen.getByText(L.surface.fourPlusOne.hints.logical)).toBeTruthy();
        fireEvent.click(views.getByRole('radio', { name: L.surface.fourPlusOne.views.scenarios }));
        expect(screen.getByTestId('kg-4plus1-scenarios')).toBeTruthy();
        fireEvent.click(views.getByRole('radio', { name: L.surface.fourPlusOne.views.physical }));
        expect(screen.getByTestId('kg-4plus1-physical')).toBeTruthy();
        expect(screen.getByText(L.surface.fourPlusOne.unitsTitle)).toBeTruthy();
    });

    it('Style shows a verdict and every style with its checks; an example selects its file', () => {
        const onSelect = mount('style');
        expect(screen.getByTestId('kg-style-verdict').textContent).toBeTruthy();
        expect(document.querySelectorAll('[data-style]')).toHaveLength(6);
        const example = document.querySelector<HTMLButtonElement>('[data-check] button');
        expect(example).toBeTruthy();
        fireEvent.click(example!);
        expect(onSelect).toHaveBeenCalledWith(example!.title);
    });

    it('Features lists the five groups; an endpoint selects the file that registers it', () => {
        const onSelect = mount('features');
        for (const g of Object.values(L.surface.keyFeatures.groups)) expect(screen.getByRole('region', { name: g })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /POST \/users/ }));
        expect(onSelect).toHaveBeenCalledWith('src:sys::api/routes.ts');
        expect(screen.getAllByText(fillTemplate(L.surface.counts.dependentOther, { count: 2 })).length).toBeGreaterThan(0);
    });
});
