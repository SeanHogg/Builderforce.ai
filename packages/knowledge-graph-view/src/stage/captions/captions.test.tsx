import { describe, expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { PLACEMENTS } from '../../compute/tasks/placement';
import { surfaceFixture } from '../../testing';
import { ZoomProvider, type ZoomApi } from '../../surface/zoom';
import { createNoopStage } from '../renderer';
import { Stage } from '../Stage';
import { CAPTION_MAX } from './CaptionLayer';
import { cssMatrix, groundAffine, inverseLinear } from './transform';

const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const t = PLACEMENTS.map(graph, model, { graph: 1, generation: model.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
while (!t.step());
const map = t.result();

describe('the caption layer\'s ONE transform', () => {
    it('is the ground plane\'s affine map, and its inverse keeps a caption upright and at its size', () => {
        const zoom = 2, tilt = Math.PI / 3;
        const m = groundAffine((x, _y, z, out) => { out[0] = x * zoom + 10; out[1] = z * zoom * Math.cos(tilt) + 20; });
        expect(m.a).toBeCloseTo(2); expect(m.d).toBeCloseTo(1); expect(m.e).toBe(10); expect(m.f).toBe(20);
        const inv = inverseLinear(m);
        expect(inv.a * m.a + inv.c * m.b).toBeCloseTo(1);
        expect(inv.b * m.c + inv.d * m.d).toBeCloseTo(1);
        expect(cssMatrix(m)).toBe('matrix(2, 0, 0, 1, 10, 20)');
        // No style write when nothing moved.
        const el = document.createElement('div');
        const last = { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN };
        expect(applyCaptionTransform(el, m, last)).toBe(true);
        expect(applyCaptionTransform(el, { ...m }, last)).toBe(false);
        expect(applyCaptionTransform(el, { ...m, e: 11 }, last)).toBe(true);
    });

    it('draws the placement\'s localized captions in the DOM and moves them all with one container transform on zoom', () => {
        let api: ZoomApi | null = null;
        const host = { register: (a: ZoomApi) => { api = a; }, unregister: () => {} };
        const { container } = render(
            <ZoomProvider host={host}>
                <Stage renderer={createNoopStage()} marks={model.marks} paint={null} placement={map} colors={null} width={800} height={500} reducedMotion selected={null} onSelect={() => {}} depthLabel="Depth" />
            </ZoomProvider>,
        );
        const layer = container.querySelector<HTMLElement>('[data-stage-captions]')!;
        const spans = [...layer.querySelectorAll('span')];
        expect(spans.map((s) => s.textContent)).toEqual(map.captions.slice(0, CAPTION_MAX).map((c) => c.text));
        expect(spans.length).toBeGreaterThan(0);
        const before = layer.style.transform;
        expect(before).toMatch(/^matrix\(/);
        const childStyles = spans.map((s) => s.getAttribute('style'));
        act(() => api!.zoomIn());
        expect(layer.style.transform).not.toBe(before);
        // Only the container moved: no caption was re-rendered or restyled.
        expect(spans.map((s) => s.getAttribute('style'))).toEqual(childStyles);
        expect(layer.style.getPropertyValue('--kg-caption-inverse')).toMatch(/^matrix\(/);
    });
});
