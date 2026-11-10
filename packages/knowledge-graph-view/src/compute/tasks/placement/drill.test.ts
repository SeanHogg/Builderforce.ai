import { describe, expect, it } from 'vitest';
import { InstancedMesh, type Object3D } from 'three';
import { surfaceFixture } from '../../../testing';
import { USE_CASE } from '../../../surface/transit/testFixtures';
import type { SymbolRecord } from '../../../types';
import { createNoopStage, createWebGLStage } from '../../../stage/renderer';
import { satelliteKeys, unfoldPatch } from '../../../stage/drill/unfold';
import { nodeIndex } from '../../../graphModel';
import { SLOT_STATION, type Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { buildSlotIncident } from '../stageIncident';
import { placeDrill } from './drill';
import { PLACEMENTS, type PlacementReq } from './index';
import { drillFrameOf, drillKeyOf } from './request';

const graph = surfaceFixture();
const model = buildStageModel(graph, []);
const { marks } = model;
const base = marks.keys.length;
const CLS = `${USE_CASE}#UseCase`;
const records: SymbolRecord[] = [
    { ref: CLS, name: 'UseCase', kind: 'class', parent: USE_CASE, line: 3, exported: true },
    { ref: `${CLS}.run`, name: 'run', kind: 'method', parent: CLS, line: 5, exported: false },
];
const req = (drill: string | null, symbols?: readonly SymbolRecord[]): PlacementReq => ({
    graph: 1, generation: marks.generation, camera: 'map', drill, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...(symbols ? { symbols } : {}),
});
const world = (): Placement => { const t = PLACEMENTS.map(graph, model, req(null)); while (!t.step()); return t.result(); };
const api = model.stations.stations.find((s) => s.name === 'API')!;
const apiSlot = model.stationSlot.get(api.id)!;
const shownSlots = (p: Placement) => p.a11y.map((a) => a.slot);
const at = (p: Placement, s: number) => [p.position[s * 3], p.position[s * 3 + 1], p.position[s * 3 + 2]];

describe('drill on the stage (PRD 43 B7: symbol slots appended + a new placement)', () => {
    it('names the frame as `<level>:<ref>` and reads it back (a ref with colons included)', () => {
        expect(drillFrameOf(drillKeyOf({ level: 'class', ref: USE_CASE }))).toEqual({ level: 'class', ref: USE_CASE });
        expect(drillFrameOf('nonsense:x')).toBeNull();
        expect(drillKeyOf(null)).toBeNull();
    });

    it('Go inside a station: its files are shown at their OWN node slots, the station shrinks away, every stop is a shown slot', () => {
        const p = placeDrill(graph, model, req(drillKeyOf({ level: 'package', ref: api.id })));
        expect(p.append).toBeUndefined();
        expect(p.scale[apiSlot]).toBe(0);
        const shown = shownSlots(p);
        const files = new Set(api.refs.map((r) => model.nodeSlot.get(r)));
        expect(shown.filter((s) => files.has(s)).length).toBeGreaterThan(0);
        // Keyed by slot: every Tab stop is a placed, shown slot of THIS placement; a neighbour is its world station's slot.
        for (const s of shown) { expect(s).toBeLessThan(p.scale.length); expect(p.scale[s]).toBeGreaterThan(0); if (!files.has(s)) expect(marks.slotKind[s]).toBe(SLOT_STATION); }
        expect(p.cacheKey).not.toBe(world().cacheKey);
    });

    it('a class level appends the loaded definitions as slots after the MarkSet, in record order, and shows them', () => {
        const p = placeDrill(graph, model, req(drillKeyOf({ level: 'class', ref: USE_CASE }), records));
        expect(p.append?.base).toBe(base);
        expect(p.append?.keys).toEqual([`node:${CLS}`, `node:${CLS}.run`]);
        expect(p.append?.parentStation[0]).toBe(apiSlot);
        expect(p.scale.length).toBe(base + 2);
        expect(p.position.length).toBe((base + 2) * 3);
        expect(shownSlots(p)).toEqual(expect.arrayContaining([base, base + 1]));
        // Append-only: a later answer with more records keeps the first two slots.
        const more = placeDrill(graph, model, req(drillKeyOf({ level: 'class', ref: USE_CASE }), [...records, { ref: `${CLS}.stop`, name: 'stop', kind: 'method', parent: CLS, line: 9, exported: false }]));
        expect(more.append?.keys.slice(0, 2)).toEqual(p.append?.keys);
        // A drill key that names no level is the world map.
        const bogus = placeDrill(graph, model, req('bogus'));
        expect(bogus.append).toBeUndefined();
        expect([...bogus.scale]).toEqual([...world().scale]);
    });

    it('the stage appends into its headroom (no mesh), and Out tweens back with the symbols collapsed into their station', () => {
        for (const stage of [createNoopStage(), createWebGLStage()]) {
            stage.setMarks(marks);
            const w = world();
            stage.setPlacement(w, 0, 0);
            const created = stage.stats.meshesCreated;
            const inside = placeDrill(graph, model, req(drillKeyOf({ level: 'class', ref: USE_CASE }), records));
            stage.setPlacement(inside, 0, 400);
            expect(stage.marks).toBe(marks);                       // no rebuild: the headroom took them
            expect(stage.stats.meshesCreated).toBe(created);
            // Every slot appended to this MarkSet so far (the model's registry: earlier answers' keys keep their slots).
            const k = inside.append!.keys.length;
            if (stage.object) expect(markCount(stage.object)).toBe(base + k);
            expect(stage.placement!.scale[base]).toBeGreaterThan(0);

            stage.setPlacement(w, 400, 400);                       // Out
            const out = stage.placement!;
            expect(out.scale.length).toBe(base + k);               // padded: the world placement covers the appended slots
            expect([out.scale[base], out.scale[base + 1]]).toEqual([0, 0]);
            expect(at(out, base)).toEqual(at(w, apiSlot));         // collapsed into the station they grew from
            expect(stage.stats.meshesCreated).toBe(created);
        }
    });

    it('a run that overflows the headroom rebuilds the marks once, with the same generation (the only mesh-creating path)', () => {
        const stage = createNoopStage();
        stage.setMarks({ ...marks, batches: marks.batches.map((b) => ({ ...b })), capacity: marks.keys.length });
        const many: SymbolRecord[] = Array.from({ length: 400 }, (_, i) => ({ ref: `${CLS}.m${i}`, name: `m${i}`, kind: 'method', parent: CLS, line: i + 1, exported: false }));
        const inside = placeDrill(graph, model, req(drillKeyOf({ level: 'class', ref: USE_CASE }), many));
        stage.setPlacement(inside, 0, 0);
        expect(stage.marks!.keys.length).toBe(base + (inside.append?.keys.length ?? 0));
        expect(stage.marks!.generation).toBe(marks.generation);
    });
});

describe('unfold on the stage (a placement patch; satellites are member slots)', () => {
    const slotOf = (k: string) => marks.keys.indexOf(k);
    const index = nodeIndex(graph);

    it('shows the station\'s satellites at their own slots around it and changes nothing else', () => {
        const w = world();
        const sats = satelliteKeys(api, index, slotOf);
        expect(sats.length).toBeGreaterThan(1);
        const p = unfoldPatch(w, apiSlot, sats, slotOf);
        expect(p).not.toBe(w);
        const satSlots = new Set(sats.map((s) => slotOf(s.key)));
        for (const s of satSlots) expect(p.scale[s]).toBeGreaterThan(0);
        for (let s = 0; s < w.scale.length; s++) if (!satSlots.has(s)) { expect(p.scale[s]).toBe(w.scale[s]); expect(at(p, s)).toEqual(at(w, s)); }
        expect(w.scale[[...satSlots][0]!]).toBe(0);              // the source placement is untouched
        const after = p.a11y.findIndex((a) => a.slot === apiSlot);
        expect(p.a11y.slice(after + 1, after + 1 + satSlots.size).map((a) => a.slot)).toEqual([...satSlots]);
        expect(p.labels.length).toBe(w.labels.length + satSlots.size);
        expect(p.cacheKey).not.toBe(w.cacheKey);
    });

    it('a hidden station (or none) unfolds to the same placement', () => {
        const w = world();
        expect(unfoldPatch(w, -1, satelliteKeys(api, index, slotOf), slotOf)).toBe(w);
    });
});

describe('the ranked incident index (B5: sent once, sliced on the main thread)', () => {
    it('lists every slot\'s neighbours best first, nodes by link weight and stations by cross-station links', () => {
        const inc = buildSlotIncident(graph, model);
        expect(inc.offsets.length).toBe(base + 1);
        for (let s = 0; s < base; s++) {
            for (let k = inc.offsets[s]! + 1; k < inc.offsets[s + 1]!; k++) expect(inc.weight[k - 1]).toBeGreaterThanOrEqual(inc.weight[k]!);
        }
        const e = graph.edges.find((x) => model.nodeSlot.has(x.from) && model.nodeSlot.has(x.to) && x.from !== x.to)!;
        const a = model.nodeSlot.get(e.from)!, b = model.nodeSlot.get(e.to)!;
        expect([...inc.neighbours.subarray(inc.offsets[a]!, inc.offsets[a + 1]!)]).toContain(b);
        expect([...inc.neighbours.subarray(inc.offsets[b]!, inc.offsets[b + 1]!)]).toContain(a);
        // Picking's tie-break importance is the MarkSet's: a node's importance, a station's use.
        expect(marks.importance[apiSlot]).toBeCloseTo(api.use, 5);
        expect(marks.importance[0]).toBeCloseTo(graph.nodes[0]!.importance, 5);
    });
});

function markCount(root: Object3D): number {
    let n = 0;
    root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) n += o.count; });
    return n;
}
