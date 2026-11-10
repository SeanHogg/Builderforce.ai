import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { InstancedMesh, type Object3D } from 'three';
import { buildStageModel } from '../compute/tasks/stageModel';
import { PLACEMENTS } from '../compute/tasks/placement';
import { useThemeColors } from '../scene/themeColors';
import { ZoomProvider, type ZoomApi } from '../surface/zoom';
import { surfaceFixture } from '../testing';
import { fixedFontPort } from './fonts';
import type { LabelText, TextPort } from './labels/LabelLayer';
import { createNoopStage, createWebGLStage, type StageRenderer } from './renderer';
import { Stage, type StageProps } from './Stage';
import { useStageRenderer } from './stageHooks';
import type { Placement } from './types';

const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const t = PLACEMENTS.map(graph, model, { graph: 1, generation: model.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
while (!t.step());
const map = t.result();

const props = (over: Partial<StageProps> = {}): StageProps => ({
    renderer: createNoopStage(), marks: model.marks, paint: null, placement: map, colors: null, width: 800, height: 500,
    reducedMotion: true, selected: null, onSelect: () => {}, depthLabel: 'Depth', ...over,
});

function zoomHost() {
    const ref: { api: ZoomApi | null } = { api: null };
    return { ref, host: { register: (a: ZoomApi) => { ref.api = a; }, unregister: () => {} } };
}

const layerOf = (c: HTMLElement) => c.querySelector<HTMLElement>('[data-stage-captions]');

describe('the generation gate', () => {
    it('a placement for another MarkSet generation is no placement: no captions, proxies or fit until they match', async () => {
        const stale: Placement = { ...map, generation: map.generation + 1 };
        const renderer = createNoopStage();
        const { container, rerender, queryAllByRole } = render(<Stage {...props({ renderer, placement: stale })} />);
        expect(container.querySelector('[data-stage-ready]')!.getAttribute('data-stage-ready')).toBe('false');
        expect(layerOf(container)).toBeNull();
        expect(renderer.placement).toBeNull();
        await new Promise((r) => setTimeout(r, 200));
        expect(queryAllByRole('button')).toHaveLength(0);
        rerender(<Stage {...props({ renderer, placement: map })} />);
        expect(container.querySelector('[data-stage-ready]')!.getAttribute('data-stage-ready')).toBe('true');
        expect(layerOf(container)!.style.transform).toMatch(/^matrix\(/);
        expect(renderer.placement).not.toBeNull();
        await waitFor(() => expect(queryAllByRole('button').length).toBeGreaterThan(0));
    });
});

describe('the rig re-homes only on a camera or bounds change', () => {
    it('an unfold patch (same camera, same extent) keeps the person\'s zoom; new bounds re-fit', () => {
        const { ref, host } = zoomHost();
        const renderer = createNoopStage();
        const view = (p: Placement) => <ZoomProvider host={host}><Stage {...props({ renderer, placement: p })} /></ZoomProvider>;
        const { container, rerender } = render(view(map));
        const fitted = layerOf(container)!.style.transform;
        act(() => ref.api!.zoomIn());
        const zoomed = layerOf(container)!.style.transform;
        expect(zoomed).not.toBe(fitted);
        // An unfold: a new placement object of the same camera and extent (another cache key, moved satellites).
        const unfolded: Placement = { ...map, cacheKey: `${map.cacheKey}|unfold`, position: map.position.slice() };
        rerender(view(unfolded));
        expect(layerOf(container)!.style.transform).toBe(zoomed);
        // A channel change: same again.
        rerender(view({ ...unfolded, cacheKey: `${map.cacheKey}|size` }));
        expect(layerOf(container)!.style.transform).toBe(zoomed);
        // Different bounds: a new home.
        const grown: Placement = { ...map, bounds: { min: map.bounds.min, max: [map.bounds.max[0] * 2, map.bounds.max[1], map.bounds.max[2] * 2] } };
        rerender(view(grown));
        expect(layerOf(container)!.style.transform).not.toBe(zoomed);
    });
});

describe('the 3D (orbit) placement on the stage', () => {
    it('holds the marks\' extrude at 1 and hides the depth control; back on Map the control and its depth return', () => {
        const t3 = PLACEMENTS['3d'](graph, model, { graph: 1, generation: model.marks.generation, camera: '3d', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth: 1 });
        while (!t3.step());
        const scene = t3.result();
        expect(scene.rig.view).toBeDefined();
        const renderer = createNoopStage();
        const { container, rerender } = render(<Stage {...props({ renderer, placement: map })} />);
        expect(container.querySelector('[data-stage-depth]')).not.toBeNull();
        expect(renderer.depth).toBe(0);
        rerender(<Stage {...props({ renderer, placement: scene })} />);
        expect(renderer.depth).toBe(1);
        expect(container.querySelector('[data-stage-depth]')).toBeNull();
        rerender(<Stage {...props({ renderer, placement: map })} />);
        expect(renderer.depth).toBe(0);
        expect(container.querySelector('[data-stage-depth]')).not.toBeNull();
    });
});

describe('Strict Mode', () => {
    const textPort = (created: { n: number }) => (): TextPort => ({
        object: null,
        create: () => { created.n++; return { text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText; },
        add() {}, remove() {}, dispose() {},
    });

    it('the renderer survives the double mount: created and disposed in one effect, planes and labels still render', () => {
        const disposed = new Set<StageRenderer>();
        const created = { n: 0 };
        let live: StageRenderer | null = null;
        function Probe() {
            const r = useStageRenderer(() => {
                const stage = createWebGLStage({ text: textPort(created), fonts: fixedFontPort({ 500: 'https://host/jbm.woff' }) });
                const dispose = stage.dispose.bind(stage);
                stage.dispose = () => { disposed.add(stage); dispose(); };
                return stage;
            });
            live = r;
            return null;
        }
        render(<StrictMode><Probe /></StrictMode>);
        expect(live).not.toBeNull();
        expect(disposed.has(live!)).toBe(false);
        const stage = live!;
        stage.setMarks(model.marks);
        stage.setPlacement(map, 0, 0);
        const planes: InstancedMesh[] = [];
        (stage.object as Object3D).traverse((o) => { if (o instanceof InstancedMesh && o.name === 'planes') planes.push(o); });
        expect(planes[0]!.count).toBe(map.planes.length);
        expect(created.n).toBeGreaterThan(0);
    });
});

describe('a theme flip, end to end', () => {
    it('CSS variables → useThemeColors → renderer.setPalette with the new colours', async () => {
        const renderer = createNoopStage();
        const setPalette = vi.spyOn(renderer, 'setPalette');
        function Host() {
            const [el, setEl] = useState<HTMLDivElement | null>(null);
            const colors = useThemeColors(el);
            return <div ref={setEl} style={{ ['--kg-bg' as string]: '#ffffff' }}><Stage {...props({ renderer, colors })} /></div>;
        }
        const { container } = render(<Host />);
        await waitFor(() => expect(setPalette).toHaveBeenCalled());
        expect(setPalette.mock.lastCall![0].bg).toBe('#ffffff');
        const host = container.firstElementChild as HTMLElement;
        act(() => {
            host.style.setProperty('--kg-bg', '#101010');
            document.body.classList.add('theme-dark'); // the flip the hook observes
        });
        await waitFor(() => expect(setPalette.mock.lastCall![0].bg).toBe('#101010'));
        document.body.classList.remove('theme-dark');
    });
});
