import { describe, expect, it } from 'vitest';
import { InstancedMesh, type Object3D } from 'three';
import { fixedFontPort } from '../../../stage/fonts';
import type { LabelText, TextPort } from '../../../stage/labels/LabelLayer';
import { createWebGLStage } from '../../../stage/renderer';
import type { Placement } from '../../../stage/types';
import { withSymbols } from '../../../surface/transit/testFixtures';
import { surfaceFixture } from '../../../testing';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const place = (camera: PlacementReq['camera']): Placement => {
    const t = PLACEMENTS[camera](graph, model, { graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
    while (!t.step());
    return t.result();
};

const textPort = (): TextPort => ({
    object: null,
    create: () => ({ text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText),
    add() {}, remove() {}, dispose() {},
});

const markMeshes = (root: Object3D): number => { let n = 0; root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) n++; }); return n; };

describe('a switch to a row camera (PRD 43 done check: 0 meshes, ≤ 3 uploads per batch)', () => {
    it.each(['system', 'heat', 'style', 'features'] as const)('map → %s → map creates no mesh and uploads ≤ 3 times per mark batch', (camera) => {
        const stage = createWebGLStage({ text: textPort, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        const map = place('map'), target = place(camera);
        stage.setPlacement(map, 0, 0);
        const created = stage.stats.meshesCreated, batches = markMeshes(stage.object!);
        expect(batches).toBe(model.marks.batches.length);
        const before = stage.stats.uploads;
        stage.setPlacement(target, 0, 400); while (stage.tick(10_000));
        expect(stage.stats.meshesCreated).toBe(created);
        expect(stage.stats.uploads - before).toBeLessThanOrEqual(3 * batches);
        stage.setPlacement(map, 20_000, 400); while (stage.tick(30_000));
        expect(stage.stats.meshesCreated).toBe(created);
        expect(markMeshes(stage.object!)).toBe(batches);
    });
});
