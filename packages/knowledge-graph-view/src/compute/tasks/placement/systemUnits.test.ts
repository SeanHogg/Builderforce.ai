import { describe, expect, it } from 'vitest';
import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { markTypeOf, TYPE_SHAPE } from '../../../shapes';
import type { LabelText, TextPort } from '../../../stage/labels/LabelLayer';
import { createWebGLStage } from '../../../stage/renderer';
import { SLOT_UNIT, type Placement } from '../../../stage/types';
import { surfaceFixture } from '../../../testing';
import { typeIndex } from '../markSet';
import { buildStageModel } from '../stageModel';
import { cameraStrings } from './cameraStrings';
import { PLACEMENTS, type PlacementReq } from './index';
import { deployBySystem } from './system';

const DESCRIPTOR = 'src:sys::api/routes.ts';
const unit = (name: string): KNode => ({ ref: `src:sys::deploy#${name}` as KNode['ref'], kind: 'entity', label: name, pack: 'code', importance: 0.4, origin: 'extracted', badges: { type: 'deployable-unit', unitKind: 'worker', runtime: 'node' } });
const binding = (name: string): KNode => ({ ref: `src:sys::deploy#binding:${name}` as KNode['ref'], kind: 'entity', label: name, pack: 'code', importance: 0.2, origin: 'extracted', badges: { type: 'deploy-binding', bindingKind: 'queue' } });
const mentions = (from: string, to: string): KEdge => ({ from: from as KEdge['from'], to: to as KEdge['to'], kind: 'mentions', weight: 1, origin: 'extracted' });

const plain = surfaceFixture();
const api = unit('api-worker'), jobs = binding('jobs');
const graph: KnowledgeGraph = { ...plain, nodes: [...plain.nodes, api, jobs], edges: [...plain.edges, mentions(DESCRIPTOR, api.ref), mentions(DESCRIPTOR, jobs.ref)] };

const textPort = (): TextPort => ({
    object: null,
    create: () => ({ text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText),
    add() {}, remove() {}, dispose() {},
});

function placements(g: KnowledgeGraph) {
    const model = buildStageModel(g, [], cameraStrings(L));
    const place = (camera: PlacementReq['camera']): Placement => {
        const t = PLACEMENTS[camera](g, model, { graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
        while (!t.step());
        return t.result();
    };
    return { model, place };
}

describe('deployable units on the System camera', () => {
    it('a unit is its own type (a capsule) and slot kind; a binding stays an entity', () => {
        expect(markTypeOf(api)).toBe('unit');
        expect(TYPE_SHAPE.unit).toBe('capsule');
        expect(markTypeOf(jobs)).toBe('entity');
        const { model } = placements(graph);
        const slot = model.nodeSlot.get(api.ref)!;
        expect(model.marks.slotKind[slot]).toBe(SLOT_UNIT);
        expect(model.marks.type[slot]).toBe(typeIndex('unit'));
    });

    it('System draws a units row (titled from the catalog) and the bindings beside the stores, each in its descriptor\'s system', () => {
        const { model, place } = placements(graph);
        const p = place('system');
        const unitSlot = model.nodeSlot.get(api.ref)!, bindingSlot = model.nodeSlot.get(jobs.ref)!;
        expect(p.scale[unitSlot]).toBeGreaterThan(0);
        expect(p.scale[bindingSlot]).toBeGreaterThan(0);
        expect(p.a11y.map((a) => a.slot)).toEqual(expect.arrayContaining([unitSlot, bindingSlot]));
        expect(p.captions.map((c) => c.text)).toContain(L.surface.system.units);
        // The unit sits in its own row: above the stores row the binding is in (rows run top to bottom).
        expect(p.position[unitSlot * 3 + 2]!).toBeLessThan(p.position[bindingSlot * 3 + 2]!);
        expect(deployBySystem(graph, model).units.map((u) => u.node.ref)).toEqual([api.ref]);
    });

    it('a graph with no unit still reserves the unit batch; Map → System → Map creates 0 meshes, with or without units', () => {
        for (const g of [plain, graph]) {
            const { model, place } = placements(g);
            expect(model.marks.batches.some((b) => b.type === typeIndex('unit'))).toBe(true);
            const stage = createWebGLStage({ text: textPort });
            stage.setMarks(model.marks);
            stage.setPlacement(place('map'), 0, 0);
            const created = stage.stats.meshesCreated;
            stage.setPlacement(place('system'), 0, 400);
            stage.setPlacement(place('map'), 400, 400);
            expect(stage.stats.meshesCreated).toBe(created);
        }
    });
});
