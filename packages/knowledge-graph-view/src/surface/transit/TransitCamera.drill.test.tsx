// @vitest-environment jsdom
/** The transit camera inside a drilled level: the question, the selection and the card work on THAT level's stations. */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { LENSES } from '../../lenses';
import { surfaceFixture } from '../../testing';
import { CAMERAS } from '../cameras';
import { useSurface, type SurfaceModel } from '../useSurface';

const graph = surfaceFixture();
const Transit = CAMERAS.find((c) => c.id === 'transit')!.component;
const seen: { surface?: SurfaceModel } = {};
const aria = (name: string, files: number, layer: string) => fillTemplate(L.surface.stationAria, { name, layer, files });

function mount() {
    function Harness() {
        const surface = useSurface(graph, null);
        seen.surface = surface;
        return (
            <Transit
                mode="transit" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys" selected={null}
                focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()}
            />
        );
    }
    return render(<Harness />);
}

function goInside() {
    fireEvent.click(screen.getByRole('button', { name: aria('API', 2, L.surface.layers.presentation) }));
    fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.goInside }));
}

describe('the transit camera in a drilled level', () => {
    it('draws the package\'s own files, with the drill as the thing "Out" goes up', () => {
        mount();
        goInside();
        expect(seen.surface!.drill.view?.level).toBe('package');
        expect(seen.surface!.drill.canOut).toBe(true);
        expect(screen.getByRole('button', { name: aria('useCase.ts', 1, L.surface.layers.application) })).toBeTruthy();
    });

    it('"Who calls this?" on a file sets the question and selects that file in the drilled level', () => {
        mount();
        goInside();
        fireEvent.click(screen.getByRole('button', { name: aria('useCase.ts', 1, L.surface.layers.application) }));
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.whoCalls }));
        expect(seen.surface!.question).toBe('callers');
        expect(seen.surface!.drill.selected).toBe(seen.surface!.drill.view!.stations.stations.find((s) => s.name === 'useCase.ts')!.id);
        // A question is asked of THIS level's stations: the files here are covered (dimmed) and the repository beside them is not (lit).
        act(() => seen.surface!.setQuestion('untested'));
        const opacityOf = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) }).getAttribute('opacity');
        expect(opacityOf('useCase.ts')).toBe('0.4');
        expect(opacityOf('repositories')).toBe('1');
    });
});
