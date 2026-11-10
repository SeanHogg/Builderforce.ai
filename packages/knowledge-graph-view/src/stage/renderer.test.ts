import { describe, expect, it } from 'vitest';
import { InstancedMesh, type BufferAttribute, type Object3D } from 'three';
import { buildStageModel } from '../compute/tasks/stageModel';
import { paintMarks } from '../compute/tasks/markPaint';
import { PLACEMENTS, type PlacementReq } from '../compute/tasks/placement';
import { PRESETS } from '../surface/overlays';
import { surfaceFixture } from '../testing';
import { withSymbols } from '../surface/transit/testFixtures';
import { createWebGLStage } from './renderer';
import type { Placement } from './types';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const place = (camera: PlacementReq['camera']): Placement => {
    const t = PLACEMENTS[camera](graph, model, { graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
    while (!t.step());
    return t.result();
};

const markMeshes = (root: Object3D): InstancedMesh[] => {
    const out: InstancedMesh[] = [];
    root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) out.push(o); });
    return out;
};
const versions = (meshes: readonly InstancedMesh[]) => meshes.map((m) => Object.values(m.geometry.attributes).reduce((n, a) => n + (a as BufferAttribute).version, 0));

describe('StageRenderer (PRD 43 B1a done checks)', () => {
    it('a camera switch creates 0 InstancedMesh and makes ≤ 3 attribute uploads per batch', () => {
        const stage = createWebGLStage();
        stage.setMarks(model.marks);
        stage.setPaint(paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null }));
        const map = place('map'), g = place('graph');
        stage.setPlacement(map, 0, 0);
        const meshes = markMeshes(stage.object!);
        expect(meshes.length).toBe(model.marks.batches.length);
        // Every batch is ONE mesh at its capacity, drawing exactly its slots.
        meshes.forEach((m, i) => expect(m.count).toBe(model.marks.batches[i]!.slots.length));

        for (const next of [g, map, g]) {
            const created = stage.stats.meshesCreated;
            const before = [...stage.stats.uploadsByBatch];
            const v0 = versions(meshes);
            stage.setPlacement(next, 0, 400);
            while (stage.tick(1_000)); // land the tween
            expect(stage.stats.meshesCreated).toBe(created);
            expect(markMeshes(stage.object!)).toEqual(meshes);
            stage.stats.uploadsByBatch.forEach((n, b) => expect(n - (before[b] ?? 0)).toBeLessThanOrEqual(3));
            // Independent of the counters: the attributes' own versions moved at most 3 per batch.
            versions(meshes).forEach((v, b) => expect(v - v0[b]!).toBeLessThanOrEqual(3));
        }
    });

    it('tweens between the two sets: t runs 0 → 1, and reduced motion (0 ms) jumps', () => {
        const stage = createWebGLStage();
        stage.setMarks(model.marks);
        stage.setPlacement(place('map'), 0, 0);
        stage.setPlacement(place('graph'), 0, 400);
        expect(stage.tick(200)).toBe(true);
        expect(stage.tick(400)).toBe(false);
        stage.setPlacement(place('map'), 1_000, 0);
        expect(stage.tick(1_001)).toBe(false);
    });

    it('a repaint uploads paint only; it never touches a placement attribute', () => {
        const stage = createWebGLStage();
        stage.setMarks(model.marks);
        stage.setPlacement(place('map'), 0, 0);
        const meshes = markMeshes(stage.object!);
        const placementVersions = () => meshes.map((m) => ['placeA', 'placeB', 'extrudeAB'].reduce((n, k) => n + (m.geometry.getAttribute(k) as BufferAttribute).version, 0));
        const v0 = placementVersions();
        stage.setPaint(paintMarks(graph, model, { lensId: 'unused', overlay: PRESETS.quality, lit: [], roles: null }));
        expect(placementVersions()).toEqual(v0);
    });
});
