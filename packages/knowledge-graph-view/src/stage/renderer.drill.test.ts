import { describe, expect, it } from 'vitest';
import { InstancedMesh, type InstancedBufferAttribute, type Object3D } from 'three';
import { buildStageModel } from '../compute/tasks/stageModel';
import { paintMarks } from '../compute/tasks/markPaint';
import { PLACEMENTS, type PlacementReq } from '../compute/tasks/placement';
import { placeDrill } from '../compute/tasks/placement/drill';
import { drillKeyOf } from '../compute/tasks/placement/request';
import { PRESETS } from '../surface/overlays';
import { USE_CASE } from '../surface/transit/testFixtures';
import { surfaceFixture } from '../testing';
import type { SymbolRecord } from '../types';
import type { LabelText, TextPort } from './labels/LabelLayer';
import { createWebGLStage } from './renderer';
import type { Placement } from './types';

// A graph of files only (the stored graph): every drilled symbol is an APPENDED slot.
const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const { marks } = model;
const base = marks.keys.length;
const CLS = `${USE_CASE}#UseCase`;
const req = (drill: string | null, symbols?: readonly SymbolRecord[]): PlacementReq => ({
    graph: 1, generation: marks.generation, camera: 'map', drill, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth: 1, ...(symbols ? { symbols } : {}),
});
const world = (): Placement => { const t = PLACEMENTS.map(graph, model, req(null)); while (!t.step()); return t.result(); };
const records = (n: number): SymbolRecord[] => [
    { ref: CLS, name: 'UseCase', kind: 'class', parent: USE_CASE, line: 1, exported: true },
    ...Array.from({ length: n }, (_, i) => ({ ref: `${CLS}.m${i}`, name: `m${i}`, kind: 'method', parent: CLS, line: i + 2, exported: false })),
];
const apiSlot = model.stationSlot.get(model.stations.stations.find((s) => s.name === 'API')!.id)!;

const textPort = (): TextPort => ({
    object: null,
    create: () => ({ text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText),
    add() {}, remove() {}, dispose() {},
});
const markMeshes = (root: Object3D): InstancedMesh[] => {
    const out: InstancedMesh[] = [];
    root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) out.push(o); });
    return out;
};
const drawn = (root: Object3D) => markMeshes(root).reduce((n, m) => n + m.count, 0);
/** The (x, y, z, scale) of slot `s` in the target placement set, read back from the mesh attributes. */
function placed(root: Object3D, set: 'placeA' | 'placeB', batch: number, instance: number): number[] {
    const a = markMeshes(root)[batch]!.geometry.getAttribute(set) as InstancedBufferAttribute;
    return [0, 1, 2, 3].map((c) => (a.array as Float32Array)[instance * 4 + c]!);
}

describe('drill append on the WebGL stage (PRD 43 B1a rule 1, B7)', () => {
    it('a drill that fits appends into the headroom: no mesh, no rebuild', () => {
        const stage = createWebGLStage({ text: textPort });
        stage.setMarks(marks);
        stage.setPlacement(world(), 0, 0);
        const created = stage.stats.meshesCreated;
        stage.setPlacement(placeDrill(graph, model, req(drillKeyOf({ level: 'class', ref: USE_CASE }), records(3))), 0, 400);
        expect(stage.marks).toBe(marks);
        expect(stage.stats.meshesCreated).toBe(created);
        expect(drawn(stage.object!)).toBe(base + 4);
    });

    it('an overflow rebuild re-uploads the FULL MarkSet including the appended slots; they survive Out, the next drill and a context restore', () => {
        const stage = createWebGLStage({ text: textPort });
        stage.setMarks(marks);
        stage.setPaint(paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null }));
        const w = world();
        stage.setPlacement(w, 0, 0);
        const created = stage.stats.meshesCreated;

        const inside = placeDrill(graph, model, req(drillKeyOf({ level: 'class', ref: USE_CASE }), records(300)));
        const k = inside.append!.keys.length;
        stage.setPlacement(inside, 0, 400);
        // Rebuilt once (the only mesh-creating path), from the MarkSet WITH the appended slots, same generation.
        expect(stage.stats.meshesCreated).toBeGreaterThan(created);
        expect(stage.marks!.keys.length).toBe(base + k);
        expect(stage.marks!.keys.slice(base)).toEqual(inside.append!.keys);
        expect(stage.marks!.generation).toBe(marks.generation);
        expect(drawn(stage.object!)).toBe(base + k);
        // Every appended slot that the level shows is in the uploaded buffers at its placed position (a rebuild jumps: both sets).
        const ms = stage.marks!;
        const shown = inside.a11y.map((a) => a.slot).filter((s) => s >= base);
        expect(shown.length).toBeGreaterThan(0);
        for (const s of shown) {
            const batch = ms.batches.findIndex((b) => b.slots.includes(s));
            const instance = ms.batches[batch]!.slots.indexOf(s);
            expect(placed(stage.object!, 'placeB', batch, instance)).toEqual([inside.position[s * 3]!, inside.position[s * 3 + 1]!, inside.position[s * 3 + 2]!, inside.scale[s]!].map((v) => Math.fround(v)));
        }

        // Out: the world placement is padded over the appended slots, collapsed (scale 0) into their station.
        const rebuilt = stage.stats.meshesCreated;
        stage.setPlacement(w, 400, 400);
        const out = stage.placement!;
        expect(out.scale.length).toBe(base + k);
        for (let s = base; s < base + k; s++) expect(out.scale[s]).toBe(0);
        expect([out.position[base * 3], out.position[base * 3 + 2]]).toEqual([w.position[apiSlot * 3], w.position[apiSlot * 3 + 2]]);
        // Back in: the slots are known, so nothing is appended or rebuilt again.
        stage.setPlacement(inside, 800, 400);
        expect(stage.stats.meshesCreated).toBe(rebuilt);
        expect(drawn(stage.object!)).toBe(base + k);
        // A lost context restores from the last inputs, appended slots included.
        stage.restore(1200);
        expect(stage.marks!.keys.length).toBe(base + k);
        expect(drawn(stage.object!)).toBe(base + k);
    });
});
