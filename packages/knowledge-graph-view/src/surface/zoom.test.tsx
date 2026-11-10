// @vitest-environment jsdom
/** The zoom contract: what the cameras register, what the registry hands the overlay. */
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { buildStageModel } from '../compute/tasks/stageModel';
import { PLACEMENTS } from '../compute/tasks/placement';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES } from '../lenses';
import { createNoopStage } from '../stage/renderer';
import { Stage } from '../stage/Stage';
import { CAMERAS } from './cameras';
import type { SceneProps } from './registry';
import { graph, probe } from './testFixtures';
import { useSurface } from './useSurface';
import { clampScale, MAX_SCALE, MIN_SCALE, ScaleZoom, useZoomHost, ZoomProvider } from './zoom';

describe('the zoom contract', () => {
    it('the stage (the Map here) registers its rig: in and out move the view about the centre, Fit restores it', () => {
        const stage = buildStageModel(graph, []);
        const t = PLACEMENTS.map(graph, stage, { graph: 1, generation: stage.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
        while (!t.step());
        const map = t.result();
        const { seen, host } = probe();
        const { container, unmount } = render(
            <ZoomProvider host={host}>
                <Stage renderer={createNoopStage()} marks={stage.marks} paint={null} placement={map} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={vi.fn()} depthLabel="Depth" />
            </ZoomProvider>,
        );
        // The caption layer moves with the camera by ONE transform: its scale is the zoom.
        const layer = container.querySelector<HTMLElement>('[data-stage-captions]')!;
        const scale = () => Number(/^matrix\(([^,]+),/.exec(layer.style.transform)![1]);
        const fitted = scale();
        expect(seen.api).not.toBeNull();
        act(() => seen.api!.zoomIn());
        const closer = scale();
        expect(closer).toBeGreaterThan(fitted);
        act(() => seen.api!.zoomOut());
        expect(scale()).toBeLessThan(closer);
        act(() => seen.api!.zoomIn());
        act(() => seen.api!.fit());
        expect(scale()).toBeCloseTo(fitted, 9);
        unmount();
        expect(seen.api).toBeNull();
    });

    it('the HTML camera (the List) registers a CSS-scale zoom, and a camera that leaves releases it', () => {
        const { seen, host } = probe();
        const List = CAMERAS.find((c) => c.id === 'list')!.component as ComponentType<SceneProps>;
        function Harness() {
            const surface = useSurface(graph, null);
            return (
                <List
                    mode="list" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys" selected={null}
                    focus={[]} reducedMotion surface={surface} onSelect={vi.fn()} onShow={vi.fn()}
                />
            );
        }
        const { container, unmount } = render(<ZoomProvider host={host}><Harness /></ZoomProvider>);
        const scale = () => Number(container.querySelector('[data-scale]')!.getAttribute('data-scale'));
        expect(scale()).toBe(1);
        act(() => seen.api!.zoomIn());
        expect(scale()).toBeGreaterThan(1);
        act(() => seen.api!.fit());
        expect(scale()).toBe(1);
        unmount();
        expect(seen.api).toBeNull();
    });

    it('a camera outside any provider still renders (it registers into nothing)', () => {
        const { container } = render(<ScaleZoom><p>inside</p></ScaleZoom>);
        expect(container.querySelector('[data-scale="1"]')).not.toBeNull();
    });
});

describe('clampScale', () => {
    it('multiplies, rounds to hundredths and stays within the cap', () => {
        expect(clampScale(1, 1.4)).toBe(1.4);
        expect(clampScale(1.4, 1.4)).toBe(1.96);
        expect(clampScale(MAX_SCALE, 1.4)).toBe(MAX_SCALE);
        expect(clampScale(MIN_SCALE, 1 / 1.4)).toBe(MIN_SCALE);
    });
});

describe('useZoomHost', () => {
    it('hands out the registered api, and a stale camera cannot release a newer one', () => {
        let host!: ReturnType<typeof useZoomHost>;
        function Probe() { host = useZoomHost(); return null; }
        render(<Probe />);
        const a = { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn() }, b = { zoomIn: vi.fn(), zoomOut: vi.fn(), fit: vi.fn() };
        expect(host.api).toBeNull();
        act(() => host.register(a));
        expect(host.api).toBe(a);
        act(() => host.register(b));
        act(() => host.unregister(a)); // the old camera unmounts after the new one registered
        expect(host.api).toBe(b);
        act(() => host.unregister(b));
        expect(host.api).toBeNull();
    });
});
