import { describe, expect, it } from 'vitest';
import { InstancedMesh, type BufferAttribute, type Object3D } from 'three';
import { surfaceFixture } from '../../../testing';
import { createWebGLStage } from '../../../stage/renderer';
import type { Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';

const base = surfaceFixture();
const graph = { ...base, nodes: base.nodes.map((node) => ({
    ...node, system: node.ref.includes('web/') ? 'web' : 'backend',
    app: node.ref.includes('db/') ? 'backend/db' : node.ref.includes('web/') ? 'web/site' : 'backend/api',
})) };
const model = buildStageModel(graph);
const { marks } = model;
const req = (camera: PlacementReq['camera']): PlacementReq => ({ graph: 1, generation: marks.generation, camera,
    drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth: 1 });
const place = (camera: PlacementReq['camera'], opts: Partial<PlacementReq> = {}): Placement => {
    const task = PLACEMENTS[camera](graph, model, { ...req(camera), ...opts });
    while (!task.step());
    return task.result();
};

const p3 = place('3d');

// Rewritten on purpose: 3D used to stack one plate per system with every station as a tower on it. It draws ONE level now
// (the design's scene): at the world, the two systems, on one floor.
describe('the 3D level scene at the world', () => {
    it('draws the two systems on ONE floor, not every station', () => {
        expect(p3.planes.filter((plane) => plane.kind === 'room')).toHaveLength(1);
        expect(p3.level).toMatchObject({ level: 'world', ref: null, total: 2 });
        expect(p3.level!.children.map((c) => c.name).sort()).toEqual(['backend', 'web']);
        expect(p3.level!.children.every((c) => c.kind === 'system' && c.form === 'slab')).toBe(true);
        expect(p3.a11y).toHaveLength(2);
        expect(p3.a11y.every(({ slot }) => p3.scale[slot]! > 0 && p3.extrude[slot]! > 0)).toBe(true);
        expect(p3.aspect).toHaveLength(marks.keys.length);
        expect(p3.captions).toEqual([]);
        expect(p3.links.some((batch) => batch.family === 'edge')).toBe(false);
        expect(p3.links.find((batch) => batch.family === 'hall')).toBeTruthy();
        expect(p3.position.every(Number.isFinite)).toBe(true);
        expect(p3.rig).toMatchObject({ projection: 'perspective', depth: { orbit: true } });
        expect(marks.slotKind.length).toBe(p3.scale.length);
    });

    it('hides a system without changing the MarkSet', () => {
        const hiddenStations = model.stations.stations.filter(({ system }) => system === 'web').map(({ id }) => id);
        const filtered = place('3d', { hiddenStations });
        expect(filtered.level!.children.map((c) => c.name)).toEqual(['backend']);
        expect(filtered.scale.length).toBe(marks.keys.length);
        for (const id of hiddenStations) expect(filtered.scale[model.stationSlot.get(id)!]).toBe(0);
    });

    it('a Map ↔ 3D switch creates 0 InstancedMesh and makes ≤ 3 attribute uploads per batch', () => {
        const stage = createWebGLStage();
        stage.setMarks(marks);
        const map = place('map');
        stage.setPlacement(map, 0, 0);
        const meshes: InstancedMesh[] = [];
        stage.object!.traverse((o: Object3D) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) meshes.push(o); });
        const versions = () => meshes.map((m) => Object.values(m.geometry.attributes).reduce((n, a) => n + (a as BufferAttribute).version, 0));
        let now = 0;
        for (const next of [p3, map, p3]) {
            const created = stage.stats.meshesCreated;
            const before = [...stage.stats.uploadsByBatch];
            const v0 = versions();
            now += 1_000;
            stage.setPlacement(next, now, 400);
            while (stage.tick(now + 1_000));
            expect(stage.stats.meshesCreated).toBe(created);
            stage.stats.uploadsByBatch.forEach((n, b) => expect(n - (before[b] ?? 0)).toBeLessThanOrEqual(3));
            versions().forEach((v, b) => expect(v - v0[b]!).toBeLessThanOrEqual(3));
        }
    });
});
