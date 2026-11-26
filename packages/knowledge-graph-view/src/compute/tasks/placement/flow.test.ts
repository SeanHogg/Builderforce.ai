import { describe, expect, it } from 'vitest';
import { surfaceFixture } from '../../../testing';
import { USE_CASE, withSymbols } from '../../../surface/transit/testFixtures';
import { SLOT_STATION, type Placement } from '../../../stage/types';
import type { SymbolRecord } from '../../../types';
import { buildStageModel } from '../stageModel';
import { DECK_RISE } from './flow';
import { PLACEMENTS, type PlacementReq } from './index';
import { drillKeyOf } from './request';

const graph = withSymbols(surfaceFixture());
const model = buildStageModel(graph);
const CLS = `${USE_CASE}#UseCase`;
const records: SymbolRecord[] = [
    { ref: CLS, name: 'UseCase', kind: 'class', parent: USE_CASE, line: 3, exported: true },
    { ref: `${CLS}.run`, name: 'run', kind: 'method', parent: CLS, line: 5, exported: false },
];

const req = (over: Partial<PlacementReq> = {}): PlacementReq =>
    ({ graph: 1, generation: model.marks.generation, camera: 'flow', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...over });
const run = (r: PlacementReq): Placement => { const t = PLACEMENTS.flow(graph, model, r); while (!t.step()); return t.result(); };
const at = (p: Placement, s: number) => [0, 1, 2].map((k) => p.position[s * 3 + k]!);
/** The shown slots (the a11y list), by x along the path. */
const shownByX = (p: Placement) => p.a11y.map((a) => a.slot).sort((a, b) => at(p, a)[0]! - at(p, b)[0]!);

/** Every slot has a finite position; hidden ones have scale 0 (anchored); the shown ones scale > 0. */
function expectEverySlotPlaced(p: Placement, slots = model.marks.keys.length): void {
    expect(p.scale.length).toBeGreaterThanOrEqual(slots);
    expect(p.position.length).toBe(p.scale.length * 3);
    expect([...p.position].every(Number.isFinite)).toBe(true);
    const shown = new Set(p.a11y.map((a) => a.slot));
    for (let i = 0; i < p.scale.length; i++) expect(p.scale[i] === 0).toBe(!shown.has(i));
}

describe('the Flow placement (PRD 43 C7)', () => {
    it('system depth: the entry line\'s stations stand on decks that rise with their step; the rest stand on the floor', () => {
        const p = run(req());
        const line = model.lines.lines[0]!;
        const onPath = line.stops.map((id) => model.stationSlot.get(id)!);
        expect(shownByX(p).filter((s) => onPath.includes(s))).toEqual(onPath);
        onPath.forEach((slot, i) => expect(at(p, slot)[1]).toBeCloseTo(i * DECK_RISE, 4));
        expect(at(p, onPath[onPath.length - 1]!)[1]).toBeGreaterThan(at(p, onPath[0]!)[1]!);
        for (const { slot } of p.a11y) {
            expect(model.marks.slotKind[slot]).toBe(SLOT_STATION);
            if (!onPath.includes(slot)) expect(at(p, slot)[1]).toBe(0);
        }
        expect(p.links.find((l) => l.family === 'route')).toBeDefined(); // the decks joining the stops
        expectEverySlotPlaced(p);
    });

    it('is deterministic: the same request lays out the same answer', () => {
        const a = run(req()), b = run(req());
        expect([...a.position]).toEqual([...b.position]);
        expect([...a.scale]).toEqual([...b.scale]);
        expect(a.cacheKey).toBe(b.cacheKey);
    });

    it('names its line: a line id as the entry picks that line\'s path', () => {
        const lines = model.lines.lines;
        const last = lines[lines.length - 1]!;
        const p = run(req({ pathId: last.id }));
        const first = model.stationSlot.get(last.stops[0]!)!;
        expect(at(p, first)[1]).toBe(0);
        expect(p.a11y.map((a) => a.slot)).toContain(first);
    });

    it('component depth (a package): the package\'s members, every other slot anchored', () => {
        const api = model.stations.stations.find((s) => s.name === 'API')!;
        const p = run(req({ drill: drillKeyOf({ level: 'package', ref: api.id }) }));
        expect(p.a11y.length).toBeGreaterThan(0);
        expectEverySlotPlaced(p);
        expect(p.cacheKey).not.toBe(run(req()).cacheKey);
    });

    it('class depth: the loaded definitions are appended slots and are placed', () => {
        // The host-loaded definitions are only appended when the resident graph lacks them: use the symbol-free graph here
        // (the module-level one already holds the symbols as resident slots, so nothing is left to append).
        const bare = surfaceFixture();
        const bareModel = buildStageModel(bare);
        const t = PLACEMENTS.flow(bare, bareModel, { ...req({ drill: drillKeyOf({ level: 'class', ref: USE_CASE }), symbols: records }), generation: bareModel.marks.generation });
        while (!t.step());
        const p = t.result();
        expect(p.append?.keys).toEqual([`node:${CLS}`, `node:${CLS}.run`]);
        expect(p.a11y.length).toBeGreaterThan(0);
        expectEverySlotPlaced(p, p.append!.keys.length); // the drilled level is its own MarkSet (not the symbol-ful module model): at least the appended definitions are placed
    });
});
