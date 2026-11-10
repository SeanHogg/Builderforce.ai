/**
 * The station card on the stage, end to end through the stage host (PRD 43 B8: migrated from the SVG map's
 * `TransitMap.card.test.tsx` and `TransitCamera.drill.test.tsx`). The host draws the Map camera with the no-op renderer
 * (the test setup's renderer port); a station's a11y proxy opens its card, the card's actions run on the surface and the
 * drill, focus returns to the station's proxy after every action, and inside a drilled level the card and the question
 * work on THAT level's stations.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../labels';
import { LENSES } from '../../lenses';
import { surfaceFixture } from '../../testing';
import { CAMERAS } from '../../surface/cameras';
import type { SceneProps } from '../../surface/registry';
import { useSurface, type SurfaceModel } from '../../surface/useSurface';
import StageHost from '../host/StageHost';

const graph = surfaceFixture();
const LIST = CAMERAS.find((c) => c.fallback)!.component!;
const seen: { surface?: SurfaceModel } = {};

function mount(over: Partial<SceneProps> = {}) {
    function Harness() {
        const surface = useSurface(graph, null);
        seen.surface = surface;
        return (
            <StageHost
                camera="map" fallback={LIST} mode="transit" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L}
                rootTitle="sys" selected={null} focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()} {...over}
            />
        );
    }
    return render(<Harness />);
}

const stationId = (name: string) => seen.surface!.stations.stations.find((s) => s.name === name)!.id;
const proxy = (key: string) => waitFor(() => {
    const el = document.querySelector<HTMLElement>(`[data-stage-proxies] [data-id="${key}"]`);
    expect(el).not.toBeNull();
    return el!;
});
const openCard = async (key: string) => { fireEvent.click(await proxy(key)); };

describe('the station card on the stage (migrated from the SVG map)', () => {
    it('opens from the station\'s proxy with its actions; Who calls, API and Go inside run, Escape closes', async () => {
        mount();
        const api = `st:${await waitFor(() => stationId('API'))}`;
        await openCard(api);
        expect(seen.surface!.station?.name).toBe('API');
        expect(screen.getByRole('dialog', { name: 'API' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.whoCalls }));
        expect(seen.surface!.question).toBe('callers');
        expect(screen.queryByRole('dialog')).toBeNull();
        // Focus goes back to the station's proxy after an action, not only after a close.
        expect(document.activeElement?.getAttribute('data-id')).toBe(api);

        await openCard(api);
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.apiContract }));
        expect(seen.surface!.panel).toBe('api');
        expect(document.activeElement?.getAttribute('data-id')).toBe(api);

        await openCard(api);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('unfolds a station and folds it again from its card', async () => {
        mount();
        await openCard(`st:${await waitFor(() => stationId('API'))}`);
        fireEvent.click(screen.getByRole('button', { name: fillTemplate(L.surface.map.card.unfold, { count: 2 }) }));
        fireEvent.click(await screen.findByRole('button', { name: L.surface.map.card.fold }));
        expect(await screen.findByRole('button', { name: fillTemplate(L.surface.map.card.unfold, { count: 2 }) })).toBeTruthy();
    });

    it('Go inside drills: the package\'s own files are on show, "Out" goes up, and Who calls selects the file in that level', async () => {
        mount();
        await openCard(`st:${await waitFor(() => stationId('API'))}`);
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.goInside }));
        await waitFor(() => expect(seen.surface!.drill.view?.level).toBe('package'));
        expect(seen.surface!.drill.canOut).toBe(true);

        const file = seen.surface!.drill.view!.stations.stations.find((s) => s.name === 'useCase.ts')!;
        await openCard(`node:${file.refs[0]}`);
        expect(screen.getByRole('dialog', { name: 'useCase.ts' })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: L.surface.map.card.whoCalls }));
        expect(seen.surface!.question).toBe('callers');
        expect(seen.surface!.drill.selected).toBe(file.id);

        act(() => seen.surface!.drill.out());
        await waitFor(() => expect(seen.surface!.drill.view).toBeNull());
    });
});
