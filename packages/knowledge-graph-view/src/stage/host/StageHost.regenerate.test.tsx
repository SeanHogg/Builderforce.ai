/**
 * A live or growth repaint regenerates the graph under a stage that is drilled into a level: the Stage stays mounted
 * (no new GL context, no rig reset), the drill stays on its level and the frame on screen is the last ready one until
 * the regenerated pair is ready.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../labels';
import { LENSES } from '../../lenses';
import { surfaceFixture } from '../../testing';
import { CAMERAS } from '../../surface/cameras';
import { useSurface, type SurfaceModel } from '../../surface/useSurface';
import { createNoopStage } from '../renderer';
import { StageFactoryContext } from './StageFactoryContext';
import StageHost from './StageHost';

const LIST = CAMERAS.find((c) => c.fallback)!.component!;
const seen: { surface?: SurfaceModel } = {};

function Harness({ graph }: { graph: ReturnType<typeof surfaceFixture> }) {
    const surface = useSurface(graph, null);
    seen.surface = surface;
    return (
        <StageHost
            camera="map" fallback={LIST} mode="transit" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L}
            rootTitle="sys" selected={null} focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()}
        />
    );
}

const tree = (graph: ReturnType<typeof surfaceFixture>) => (
    <StageFactoryContext.Provider value={() => createNoopStage()}>
        <Harness graph={graph} />
    </StageFactoryContext.Provider>
);
const proxies = () => document.querySelector<HTMLElement>('[data-stage-proxies]');

describe('StageHost across a regenerated graph', () => {
    it('keeps the Stage mounted and the drill on its level while the regenerated frame computes', async () => {
        const first = surfaceFixture();
        const { rerender } = render(tree(first));
        const api = await waitFor(() => seen.surface!.stations.stations.find((s) => s.name === 'API')!.id);
        const station = await waitFor(() => {
            const el = document.querySelector<HTMLElement>(`[data-stage-proxies] [data-id="st:${api}"]`);
            expect(el).not.toBeNull();
            return el!;
        });
        fireEvent.click(station);
        fireEvent.click(await waitFor(() => {
            const b = [...document.querySelectorAll('button')].find((x) => x.textContent === L.surface.map.card.goInside);
            expect(b).toBeTruthy();
            return b!;
        }));
        await waitFor(() => expect(seen.surface!.drill.view?.level).toBe('package'));
        const mounted = proxies();
        expect(mounted).not.toBeNull();

        // The same graph, rebuilt: a new object, so a new generation whose MarkSet and placement are still to be computed.
        await act(async () => { rerender(tree({ ...first, nodes: [...first.nodes] })); });
        expect(proxies()).toBe(mounted);
        expect(seen.surface!.drill.view?.level).toBe('package');
        await waitFor(() => expect(seen.surface!.drill.view?.level).toBe('package'));
        expect(proxies()).toBe(mounted);
    });
});
