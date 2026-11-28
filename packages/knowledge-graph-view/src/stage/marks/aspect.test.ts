/** The footprint aspect pair (`aspect.ts`) and how a placement carries it into the mark batches (A/B sets, bake, append). */
import { describe, expect, it } from 'vitest';
import { InstancedMesh, type BufferAttribute, type Object3D } from 'three';
import { buildStageModel } from '../../compute/tasks/stageModel';
import { PLACEMENTS, type PlacementReq } from '../../compute/tasks/placement';
import { surfaceFixture } from '../../testing';
import { createWebGLStage } from '../renderer';
import type { Placement } from '../types';
import { ASPECT_GLSL, aspectOf, PACKED_ONE, withAspect } from './aspect';

describe('aspect pair', () => {
    it('1 is exact in both sets, and a code is within 0.2 % across the range', () => {
        expect(aspectOf(PACKED_ONE, 0)).toBe(1);
        expect(aspectOf(PACKED_ONE, 1)).toBe(1);
        for (const a of [0.125, 0.3, 0.7, 1.4, 2.5, 7.9]) {
            const packed = withAspect(withAspect(PACKED_ONE, 0, a), 1, 1 / a);
            expect(aspectOf(packed, 0) / a).toBeCloseTo(1, 2);
            expect(aspectOf(packed, 1) * a).toBeCloseTo(1, 2);
        }
    });

    it('writes one set and leaves the other; a bad value reads as 1; the pair is exact in a float32', () => {
        const packed = withAspect(PACKED_ONE, 1, 0.5);
        expect(aspectOf(packed, 0)).toBe(1);
        expect(aspectOf(packed, 1)).toBeCloseTo(0.5, 2);
        expect(aspectOf(withAspect(PACKED_ONE, 0, Number.NaN), 0)).toBe(1);
        expect(aspectOf(withAspect(PACKED_ONE, 0, 0), 0)).toBe(1);
        const widest = withAspect(withAspect(0, 0, 8), 1, 8);
        expect(Math.fround(widest)).toBe(widest);
        expect(ASPECT_GLSL).toContain('aspectsOf');
    });
});

const graph = surfaceFixture();
const model = buildStageModel(graph);
const place = (camera: PlacementReq['camera']): Placement => {
    const t = PLACEMENTS[camera](graph, model, { graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
    while (!t.step());
    return t.result();
};
const meshesOf = (root: Object3D): InstancedMesh[] => {
    const out: InstancedMesh[] = [];
    root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) out.push(o); });
    return out;
};

describe('MarkLayer carries Placement.aspect', () => {
    it('a placement without aspect draws every mark square; one with it writes its slot into the stale set only', () => {
        const stage = createWebGLStage();
        stage.setMarks(model.marks);
        const base = place('map');
        stage.setPlacement(base, 0, 0);
        const [mesh] = meshesOf(stage.object!);
        const ex = mesh!.geometry.getAttribute('extrudeAB') as BufferAttribute;
        expect(ex.itemSize).toBe(4);
        expect(aspectOf(ex.array[3]!, 0)).toBe(1);
        expect(aspectOf(ex.array[3]!, 1)).toBe(1);

        const slot = stage.marks!.batches[0]!.slots[0]!;
        const aspect = new Float32Array(base.scale.length).fill(1);
        aspect[slot] = 0.6;
        stage.setPlacement({ ...base, aspect }, 0, 400);
        // The first placement filled A and B; the swap wrote the stale set (A), the target keeps its square.
        const sets = [aspectOf(ex.array[3]!, 0), aspectOf(ex.array[3]!, 1)];
        expect(sets.filter((v) => Math.abs(v - 0.6) < 0.01)).toHaveLength(1);
        expect(sets.filter((v) => v === 1)).toHaveLength(1);
    });
});
