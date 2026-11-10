/**
 * The DOM System, Heat, Style and Features bodies retired at make-default (PRD 43 B8, P5). Each structural fact their
 * tests held is asserted here as THE SAME FACT of the placement (and, for paint, `markPaint`), per the PRD's Tests
 * migration rule. Facts the row placements already prove (`rowCameras.test.ts`: tier, store, style-layer and feature
 * group planes) are not repeated.
 */
import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L, fillTemplate } from '../../../labels';
import { bandStrings } from '../../../surface/bands';
import { HEAT_CELL_CAP } from '../../../surface/heatCells';
import { PRESETS } from '../../../surface/overlays';
import { architectureStyleOf, percentOf } from '../../../surface/style/architectureStyle';
import { MAX_PER_TIER } from '../../../surface/system/systemModel';
import { codeFixture, surfaceFixture } from '../../../testing';
import { BG_TONE } from '../../../stage/tones';
import { SLOT_STATION, type Placement } from '../../../stage/types';
import { paintMarks } from '../markPaint';
import { buildStageModel, type StageModel } from '../stageModel';
import { cameraStrings } from './cameraStrings';
import { PLACEMENTS, type PlacementReq } from './index';

const strings = { ...bandStrings(L), ...cameraStrings(L) };
type RowCamera = 'system' | 'heat' | 'style';

function place(graph: KnowledgeGraph, camera: RowCamera, channels?: PlacementReq['channels']): { p: Placement; model: StageModel } {
    const model = buildStageModel(graph, [], strings);
    const req: PlacementReq = { graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...(channels ? { channels } : {}) };
    const t = PLACEMENTS[camera](graph, model, req);
    while (!t.step());
    return { p: t.result(), model };
}

/** `count` area-less folders of one file each, in one layer: `count` stations (the retired SystemTiers test's fixture). */
function folders(count: number, partition: string | undefined): KnowledgeGraph {
    const nodes = Array.from({ length: count }, (_, i) => ({
        ref: `src:s::${partition ?? 'x'}${i}/a.ts`, kind: 'file', label: `${partition ?? 'x'}${i}/a.ts`, pack: 'code', importance: 0.5 - i / 1000, origin: 'extracted', sourceHash: `h${i}`, ...(partition ? { partition } : {}),
    }));
    return { ...surfaceFixture(), nodes, edges: [], findings: [] } as unknown as KnowledgeGraph;
}

const shownStations = (p: Placement, model: StageModel): number => p.a11y.filter((a) => model.marks.slotKind[a.slot] === SLOT_STATION).length;
const captionTexts = (p: Placement): string[] => p.captions.map((c) => c.text);
const bandTitles = (p: Placement): string[] => p.captions.filter((c) => c.role === 'band').map((c) => c.text);

describe('System placement (was SystemTiers)', () => {
    it(`shows at most ${MAX_PER_TIER} marks in a tier, then a "+N more" caption for the rest`, () => {
        const { p, model } = place(folders(9, 'domain'), 'system');
        expect(bandTitles(p)).toEqual([L.surface.layers.domain]);
        expect(shownStations(p, model)).toBe(MAX_PER_TIER);
        expect(captionTexts(p)).toContain(fillTemplate(L.surface.system.more, { count: 3 }));
    });

    it('a tier that fits says no "+N more"', () => {
        const { p } = place(surfaceFixture(), 'system');
        const more = fillTemplate(L.surface.system.more, { count: 0 }).replace('0', '');
        expect(captionTexts(p).some((t) => t !== more && t.startsWith(more.trim()) && /\d/.test(t))).toBe(false);
    });

    it('places no mark for a station in no layer and on no line (no "other" tier)', () => {
        const { p, model } = place(folders(5, undefined), 'system');
        expect(shownStations(p, model)).toBe(0);
        expect(bandTitles(p)).not.toContain(L.surface.layers.other);
    });

    it('the stores plane holds the data store a line ends in, titled as the DOM store row', () => {
        const { p, model } = place(surfaceFixture(), 'system');
        const repo = model.stations.stations.find((s) => s.name === 'repositories')!;
        const slot = model.stationSlot.get(repo.id)!;
        expect(p.scale[slot]).toBeGreaterThan(0);
        const plane = p.planes[bandTitles(p).indexOf(L.surface.system.data)]!;
        expect(plane).toBeTruthy();
        const z = p.position[slot * 3 + 2]!;
        expect(z).toBeGreaterThanOrEqual(plane.min[2]);
        expect(z).toBeLessThanOrEqual(plane.max[2]);
    });

    it('no line ends in a store: no stores plane', () => {
        const { p } = place(folders(2, 'domain'), 'system');
        expect(bandTitles(p)).not.toContain(L.surface.system.data);
    });
});

describe('row-camera paint (was the System card\'s colour dot and ring bar, the Heat cell\'s colour and bar)', () => {
    it('the ring channel paints the coverage band where it has data, and nothing where the metric is not set up', () => {
        const graph = surfaceFixture();
        const model = buildStageModel(graph, [], strings);
        const paint = paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null });
        const api = model.stationSlot.get(model.stations.stations.find((s) => s.name === 'API')!.id)!;
        expect(paint.tone2[api]).not.toBe(BG_TONE);
        const bare = codeFixture();
        const bareModel = buildStageModel(bare, [], strings);
        const barePaint = paintMarks(bare, bareModel, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null });
        for (const slot of bareModel.stationSlot.values()) { expect(barePaint.tone2[slot]).toBe(BG_TONE); expect(barePaint.fill[slot]).toBe(0); }
    });
});

describe('Heat placement (was HeatGrid)', () => {
    it(`places at most HEAT_CELL_CAP (${HEAT_CELL_CAP}) cells and counts the rest`, () => {
        const total = HEAT_CELL_CAP + 50;
        const { p, model } = place(folders(total, 'application'), 'heat');
        const stations = model.stations.stations.length;
        expect(shownStations(p, model)).toBe(Math.min(HEAT_CELL_CAP, stations));
        if (stations > HEAT_CELL_CAP) expect(captionTexts(p)).toContain(fillTemplate(L.surface.system.more, { count: stations - HEAT_CELL_CAP }));
        expect(p.caption.capped).toBe(stations > HEAT_CELL_CAP);
    });

    it('a cell is larger for a larger size level (the size channel)', () => {
        const { p, model } = place(surfaceFixture(), 'heat', { size: PRESETS.risk.size, width: PRESETS.risk.width });
        const scaleOf = (name: string) => p.scale[model.stationSlot.get(model.stations.stations.find((s) => s.name === name)!.id)!]!;
        expect(scaleOf('API')).toBeGreaterThanOrEqual(scaleOf('cron'));
        expect(scaleOf('cron')).toBeGreaterThan(0);
    });
});

describe('Style placement (was ArchitectureStyleCamera)', () => {
    it('captions its planes with the verdict, in the DOM camera\'s words', () => {
        const graph = surfaceFixture();
        const { p } = place(graph, 'style');
        const a = architectureStyleOf(graph);
        const verdict = a.winner && a.styles[0]
            ? fillTemplate(L.surface.architectureStyle.verdict, { style: L.surface.architectureStyle.styles[a.winner], percent: percentOf(a.styles[0].fit) })
            : L.surface.architectureStyle.verdictNone;
        expect(p.captions.find((c) => c.role === 'plane')?.text).toBe(verdict);
    });
});
