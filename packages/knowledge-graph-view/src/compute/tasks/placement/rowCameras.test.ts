import { describe, expect, it } from 'vitest';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { bandStrings } from '../../../surface/bands';
import { FEATURE_GROUPS, keyFeaturesOf } from '../../../surface/features/keyFeatures';
import { HEAT_CELL_CAP } from '../../../surface/heatCells';
import { LAYER_ORDER } from '../../../surface/layers';
import { sourceFilesOf } from '../../../surface/sourceFiles';
import { buildSystemGroups } from '../../../surface/system/systemGroups';
import { buildSystemLayout } from '../../../surface/system/systemModel';
import { buildTiers } from '../../../surface/tiers';
import { withSymbols } from '../../../surface/transit/testFixtures';
import { surfaceFixture } from '../../../testing';
import { SLOT_NODE, type Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { cameraStrings } from './cameraStrings';
import { PLACEMENTS, type PlacementReq } from './index';
import { STYLE_ROW_CAP } from './style';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph, [], { ...bandStrings(L), ...cameraStrings(L) });
const { marks } = model;
type RowCamera = 'system' | 'heat' | 'style' | 'features';
const CAMERAS: readonly RowCamera[] = ['system', 'heat', 'style', 'features'];
const req = (camera: RowCamera, depth = 0): PlacementReq => ({ graph: 1, generation: marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, depth });
const place = (camera: RowCamera, depth = 0): Placement => { const t = PLACEMENTS[camera](graph, model, req(camera, depth)); while (!t.step()); return t.result(); };
const shownOf = (p: Placement): number[] => p.a11y.map((a) => a.slot);
const slotOfStation = (id: string): number => model.stationSlot.get(id)!;
const bandCaptions = (p: Placement): string[] => p.captions.filter((c) => c.role === 'band').map((c) => c.text);

describe('row cameras (PRD 43 B1a rule 8: System, Heat, Style, Features are placements of the same marks)', () => {
    it.each(CAMERAS)('%s: covers every slot; shown slots have scale > 0 and are distinct; the rest are anchored at scale 0', (camera) => {
        const p = place(camera);
        const n = marks.keys.length;
        expect(p.position.length).toBe(n * 3);
        expect(p.scale.length).toBe(n);
        expect(p.extrude.length).toBe(n);
        const shown = shownOf(p);
        expect(shown.length).toBeGreaterThan(0);
        expect(new Set(shown).size).toBe(shown.length);
        const on = new Set(shown);
        for (let i = 0; i < n; i++) {
            expect(Number.isFinite(p.position[i * 3]!)).toBe(true);
            if (on.has(i)) expect(p.scale[i]).toBeGreaterThan(0); else expect(p.scale[i]).toBe(0);
        }
        expect(p.planes.length).toBe(bandCaptions(p).length);
        expect(p.rig.frame).toBe('fill');
    });

    it.each(CAMERAS)('%s: a hidden node sits at its station when the station is shown', (camera) => {
        const p = place(camera);
        const on = new Set(shownOf(p));
        let checked = 0;
        for (let i = 0; i < graph.nodes.length; i++) {
            const st = marks.parentStation[i]!;
            if (on.has(i) || marks.slotKind[i] !== SLOT_NODE || st < 0 || !on.has(st)) continue;
            expect([0, 1, 2].map((k) => p.position[i * 3 + k])).toEqual([0, 1, 2].map((k) => p.position[st * 3 + k]));
            checked++;
        }
        if (camera === 'system' || camera === 'heat') expect(checked).toBeGreaterThan(0);
    });

    it('System: the same tiers, shown stations and stores as the DOM camera', () => {
        const p = place('system');
        const groups = buildSystemGroups(model.stations, model.lines, graph);
        const layouts = groups.length > 0 ? groups.map((g) => g.layout) : [buildSystemLayout(model.stations, model.lines, graph)];
        const expected = new Set(layouts.flatMap((l) => [...l.tiers.flatMap((t) => t.shown.map((s) => s.id)), ...l.stores.map((t) => t.stationId)]).map(slotOfStation));
        expect(new Set(shownOf(p))).toEqual(expected);
        const titles = layouts.flatMap((l) => [...l.tiers.map((t) => L.surface.layers[t.layer as keyof typeof L.surface.layers]), ...(l.stores.length ? [L.surface.system.data] : [])]);
        expect(bandCaptions(p)).toEqual(titles);
        // Stations in no layer and on no line stay hidden.
        for (const l of layouts) for (const s of l.notLayered) expect(p.scale[slotOfStation(s.id)]).toBe(0);
    });

    it('Heat: one plane per tier, every station up to the cap; tilt extrudes, height = heat', () => {
        const p = place('heat');
        const tiers = buildTiers(model.stations.stations);
        expect(bandCaptions(p)).toEqual(tiers.map((t) => L.surface.layers[t.layer as keyof typeof L.surface.layers]));
        expect(shownOf(p)).toEqual(tiers.flatMap((t) => t.stations).slice(0, HEAT_CELL_CAP).map((s) => slotOfStation(s.id)));
        const tilted = place('heat', 1);
        for (const s of shownOf(p)) { expect(p.extrude[s]).toBe(0); expect(tilted.extrude[s]).toBeGreaterThan(0); }
        expect(tilted.cacheKey).not.toBe(p.cacheKey);
    });

    it('Style: one plane per layer holding that layer\'s source files, under the verdict', () => {
        const p = place('style');
        const files = sourceFilesOf(graph);
        const layers = LAYER_ORDER.filter((l) => files.some((n) => n.partition === l));
        expect(bandCaptions(p)).toEqual(layers.map((l) => L.surface.layers[l]));
        const expected = layers.flatMap((l) => files.filter((n) => n.partition === l).slice(0, STYLE_ROW_CAP).map((n) => model.nodeSlot.get(n.ref)!));
        expect(new Set(shownOf(p))).toEqual(new Set(expected));
        expect(p.captions.find((c) => c.role === 'plane')?.text).toBeTruthy();
    });

    it('Features: the five groups, each holding its features\' marks', () => {
        const p = place('features');
        expect(bandCaptions(p)).toEqual(FEATURE_GROUPS.map((g) => L.surface.keyFeatures.groups[g]));
        const f = keyFeaturesOf(graph, model.stations);
        const on = new Set(shownOf(p));
        for (const g of FEATURE_GROUPS) for (const feat of f[g].items) {
            const slot = feat.ref !== undefined ? model.nodeSlot.get(feat.ref) : feat.stationId !== undefined ? model.stationSlot.get(feat.stationId) : undefined;
            if (slot !== undefined) expect(on.has(slot)).toBe(true);
        }
    });
});
