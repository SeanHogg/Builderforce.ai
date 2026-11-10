import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../../testing';
import { withSymbols } from '../../../surface/transit/testFixtures';
import { SLOT_NODE, SLOT_STATION, type Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { PLACEMENTS, type PlacementReq } from './index';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, []);
const { marks } = model;
const req = (camera: PlacementReq['camera']): PlacementReq => ({ graph: 1, generation: marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0 });
const place = (camera: PlacementReq['camera']): Placement => { const t = PLACEMENTS[camera](graph, model, req(camera)); while (!t.step()); return t.result(); };
const at = (p: Placement, s: number) => [p.position[s * 3], p.position[s * 3 + 1], p.position[s * 3 + 2]];

describe('placement (PRD 43 B1a rule 4: visibility is scale)', () => {
    it('anchors a hidden aggregate at its visible members\' centroid and a hidden node at its ancestor, at scale 0', () => {
        // slots: 0,1 nodes of station 3; 2 a node of station 4; 3,4 stations; 5 a folder holding 0 and 1.
        const forest = {
            slotKind: Uint8Array.from([SLOT_NODE, SLOT_NODE, SLOT_NODE, SLOT_STATION, SLOT_STATION, 2]),
            parentStation: Int32Array.from([3, 3, 4, -1, -1, -1]),
            parentFolder: Int32Array.from([5, 5, -1, -1, -1, -1]),
        };
        const d = draftFor(6);
        show(d, 0, 0, 0, 0, 1); show(d, 1, 10, 0, 20, 1); show(d, 4, 50, 0, 50, 8);
        anchorHidden(forest, d, 'station', [99, 0, 99]);
        expect([...d.position.slice(9, 12)]).toEqual([5, 0, 10]);   // station 3 at its members' centroid
        expect([...d.position.slice(15, 18)]).toEqual([5, 0, 10]);  // folder 5 too
        expect([...d.position.slice(6, 9)]).toEqual([50, 0, 50]);   // node 2 at its (visible) station
        expect([d.scale[2], d.scale[3], d.scale[5]]).toEqual([0, 0, 0]);
        expect([d.scale[0], d.scale[1], d.scale[4]]).toEqual([1, 1, 8]);
    });

    it('Map: shows the drawn stations; every node sits at its station at scale 0', () => {
        const p = place('map');
        const shown = p.a11y.map((a) => a.slot);
        expect(shown.length).toBeGreaterThan(0);
        for (const s of shown) { expect(marks.slotKind[s]).toBe(SLOT_STATION); expect(p.scale[s]).toBeGreaterThan(0); }
        for (let i = 0; i < graph.nodes.length; i++) {
            expect(p.scale[i]).toBe(0);
            const st = marks.parentStation[i]!;
            if (st >= 0) expect(at(p, i)).toEqual(at(p, st));
        }
        expect(p.links[0]!.family).toBe('route');
        expect(p.links[0]!.casing).toBeDefined();
        expect(p.position.length).toBe(marks.keys.length * 3);
    });

    it('Map tilt is extrude: depth 0 is flat, depth 1 raises every shown station', () => {
        const flat = place('map');
        const t = PLACEMENTS.map(graph, model, { ...req('map'), depth: 1 }); while (!t.step());
        const tilted = t.result();
        for (const { slot } of flat.a11y) { expect(flat.extrude[slot]).toBe(0); expect(tilted.extrude[slot]).toBeGreaterThan(0); }
        expect(tilted.cacheKey).not.toBe(flat.cacheKey);
    });

    it('Graph: shows the nodes; each station shrinks to the centroid of its shown members at scale 0', () => {
        const p = place('graph');
        const shown = p.a11y.map((a) => a.slot);
        expect(shown.length).toBe(Math.min(2000, graph.nodes.length));
        for (const s of shown) expect(p.scale[s]).toBeGreaterThan(0);
        model.stations.stations.forEach((s) => {
            const slot = model.stationSlot.get(s.id)!;
            expect(p.scale[slot]).toBe(0);
            const members = shown.filter((i) => marks.parentStation[i] === slot);
            if (members.length === 0) return;
            const mean = [0, 1, 2].map((k) => members.reduce((sum, i) => sum + p.position[i * 3 + k]!, 0) / members.length);
            at(p, slot).forEach((v, k) => expect(v).toBeCloseTo(mean[k]!, 3));
        });
    });
});
