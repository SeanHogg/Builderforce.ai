// @vitest-environment jsdom
/** The zoom contract: what the cameras register, what the registry hands the overlay. */
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../labels';
import { LENSES } from '../lenses';
import { CAMERAS } from './cameras';
import type { SceneProps } from './registry';
import { graph, lines, model, overlay, probe } from './testFixtures';
import { TransitMap } from './TransitMap';
import { useSurface } from './useSurface';
import { clampScale, MAX_SCALE, MIN_SCALE, ScaleZoom, useZoomHost, ZoomProvider } from './zoom';

describe('the zoom contract', () => {
    it('the transit map registers an api whose zoom moves its viewBox and whose Fit restores it', () => {
        const { seen, host } = probe();
        const { container } = render(
            <ZoomProvider host={host}>
                <TransitMap
                    stations={model} lines={lines} overlay={overlay} labels={L} lit={null} lineId={lines.lines[0]!.id} selectedStation={null} pins={[]}
                    reducedMotion onSelectStation={vi.fn()} onSelectLine={vi.fn()} label="map"
                />
            </ZoomProvider>,
        );
        const width = () => Number(container.querySelector('svg')!.getAttribute('viewBox')!.split(' ')[2]);
        const fitted = width();
        expect(seen.api).not.toBeNull();
        act(() => seen.api!.zoomIn());
        const closer = width();
        expect(closer).toBeLessThan(fitted);
        act(() => seen.api!.zoomOut());
        expect(width()).toBeGreaterThan(closer);
        act(() => seen.api!.zoomIn());
        act(() => seen.api!.fit());
        expect(width()).toBe(fitted);
    });

    it('the HTML cameras (System here) register a CSS-scale zoom, and a camera that leaves releases it', () => {
        const { seen, host } = probe();
        const System = CAMERAS.find((c) => c.id === 'system')!.component as ComponentType<SceneProps>;
        function Harness() {
            const surface = useSurface(graph, null);
            return (
                <System
                    mode="system" graph={graph} drawn={{ nodes: graph.nodes, edges: graph.edges }} lens={LENSES.structure} labels={L} rootTitle="sys" selected={null}
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
