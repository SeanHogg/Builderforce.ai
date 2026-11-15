// @vitest-environment jsdom
/**
 * The transit map inside a drilled level (PRD 43: the transit camera is now the Map placement of the one stage, and its
 * DOM face is the `TransitMap`): the question, the selection and the card work on THAT level's stations.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { counted } from '../plural';
import { buildLines } from '../lines';
import { makeOverlay, PRESETS } from '../overlays';
import { buildStations } from '../stations';
import { TransitMap } from '../TransitMap';
import { useSurface, type SurfaceModel } from '../useSurface';
import { surfaceFixture } from '../../testing';
import { withSymbols } from './testFixtures';

const graph = surfaceFixture();
const world = buildStations(graph);
const lines = buildLines(graph, world);
const overlay = makeOverlay(PRESETS.risk, world.stations);
const seen: { surface?: SurfaceModel } = {};
const aria = (name: string, files: number, layer: string) => fillTemplate(L.surface.stationAria, { name, layer, files: counted(L, 'file', files) });

function mount(graphToDraw: typeof graph = withSymbols()) {
    const stations = buildStations(graphToDraw), drawLines = buildLines(graphToDraw, stations), drawOverlay = makeOverlay(PRESETS.risk, stations.stations);
    function Harness() {
        const surface = useSurface(graphToDraw, null);
        seen.surface = surface;
        const level = surface.drill.view;
        return (
            <TransitMap
                graph={graphToDraw} stations={level?.stations ?? surface.stations} lines={drawLines} overlay={drawOverlay} labels={L}
                lit={level ? surface.lit : null} lineId={surface.line?.id ?? null} selectedStation={surface.drill.selected ?? surface.station?.id ?? null}
                pins={surface.pins} reducedMotion order={level?.order} leaves={level?.leaves} levelNote={null}
                canEnter={surface.drill.canEnter} onEnter={surface.drill.enter} onQuestion={surface.setQuestion} onOpenPanel={surface.openPanel}
                onSelectStation={surface.drill.view ? surface.drill.select : surface.selectStation} onSelectLine={surface.selectLine} label="map"
            />
        );
    }
    return render(<Harness />);
}

function goInside() {
    fireEvent.click(screen.getByRole('button', { name: aria('API', 2, L.surface.layers.presentation) }));
    fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.goInside }));
}

describe('the transit map in a drilled level', () => {
    it('draws the package\'s own files, with the drill as the thing "Out" goes up', () => {
        mount();
        goInside();
        expect(seen.surface!.drill.view?.level).toBe('package');
        expect(seen.surface!.drill.canOut).toBe(true);
        // The drilled level shows the package's own files (its symbols), not the world map's stations.
        expect(seen.surface!.drill.view!.stations.stations.some((s) => s.name === 'useCase.ts' || s.name === 'UseCase')).toBe(true);
    });

    it('"Who calls this?" on a file sets the question and selects that file in the drilled level', () => {
        mount();
        goInside();
        // Pick a file of the drilled level through the map (opens its card), then "Who calls this?".
        const file = seen.surface!.drill.view!.stations.stations.find((s) => s.name === 'useCase.ts')!;
        fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${file.name}, `) }));
        expect(seen.surface!.drill.selected).toBe(file.id);
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.whoCalls }));
        expect(seen.surface!.question).toBe('callers');
        expect(seen.surface!.drill.selected).toBe(file.id);
    });
});
