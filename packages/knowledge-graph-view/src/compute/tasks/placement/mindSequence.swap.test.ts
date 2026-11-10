import { describe, expect, it } from 'vitest';
import type { KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { surfaceFixture } from '../../../testing';
import { FAIL_REF, RUN_REF, withSymbols } from '../../../surface/transit/testFixtures';
import { fixedFontPort } from '../../../stage/fonts';
import type { LabelText, TextPort } from '../../../stage/labels/LabelLayer';
import { createWebGLStage } from '../../../stage/renderer';
import type { Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';

const base = withSymbols(surfaceFixture());
const call: KEdge = { from: RUN_REF as KEdge['from'], to: FAIL_REF as KEdge['to'], kind: 'calls', weight: 1, origin: 'extracted', sites: [{ path: 'api/useCase.ts', line: 3, column: 2, order: 0 }] };
const graph: KnowledgeGraph = { ...base, edges: [...base.edges, call] };
const model = buildStageModel(graph, []);
const place = (camera: PlacementReq['camera'], over: Partial<PlacementReq> = {}): Placement => {
    const t = PLACEMENTS[camera](graph, model, { graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...over });
    while (!t.step());
    return t.result();
};
const text = (): TextPort => ({
    object: null,
    create: () => ({ text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText),
    add() {}, remove() {}, dispose() {},
});

describe('Mind map and Sequence are placements of the SAME marks (PRD 43 B1a done checks)', () => {
    it('switching Map → Mind map → Sequence (system and method band) → Map creates 0 meshes', () => {
        const stage = createWebGLStage({ text, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        stage.setPlacement(place('map'), 0, 0);
        const created = stage.stats.meshesCreated;
        let now = 0;
        for (const p of [place('mind'), place('sequence'), place('sequence', { lod: 2, pathId: `node:${RUN_REF}` }), place('map')]) {
            now += 1000;
            stage.setPlacement(p, now, 400);
            while (stage.tick(now + 10_000));
        }
        expect(stage.stats.meshesCreated).toBe(created);
    });
});
