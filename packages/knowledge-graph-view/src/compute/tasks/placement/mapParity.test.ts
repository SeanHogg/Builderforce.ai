/**
 * The Map placement and paint say every fact the retired SVG map drew (PRD 43 B8, Tests: "each SVG-structure assertion
 * is rewritten as a spec-builder assertion of the SAME fact"). Migrated from `transit/marks.test.tsx`,
 * `TowerMark.test.tsx`, `TransitMap.tower.test.tsx` and `TransitMap.card.test.tsx`'s drawing cases:
 *
 * - a hop: the casing under the line, its width channel, an untested hop dashed 9/7 in the violation tone, a cycle hop
 *   dashed 3/5 — never colour alone;
 * - the HTTP boundary wall dashed 5/4; a document station in the doc type with a dashed 2/5 describes link;
 * - a station: its interchange backing, its coverage arc (tone2 + fill), the dotted shell for MEASURED zero coverage,
 *   the pulse and the dashed outline, from the overlay exactly as the SVG mark read them;
 * - a tower: 14 + 16 per level tall (the size channel, else the complexity level), the anti-pattern roles' tones with
 *   every other station dimmed.
 */
import { describe, expect, it } from 'vitest';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { ROLE_TONE } from '../../../scene/highlightRoles';
import { MARK_TYPE_ORDER } from '../../../shapes';
import { makeOverlay, PRESETS, segmentUntested } from '../../../surface/overlays';
import { towerHeight } from '../../../surface/transit/towerHeight';
import { withDocs } from '../../../surface/transit/testFixtures';
import { surfaceFixture } from '../../../testing';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import { DASH_CYCLE, DASH_DESCRIBES, DASH_SOLID, DASH_UNTESTED, DASH_WALL, FLAG, type LinkBatch, type Placement } from '../../../stage/types';
import { paintMarks } from '../markPaint';
import { buildStageModel, type StageModel } from '../stageModel';
import { PLACEMENTS, type PlacementReq } from './index';
import { channelBindings } from './request';

const req = (m: StageModel, over: Partial<PlacementReq> = {}): PlacementReq =>
    ({ graph: 1, generation: m.marks.generation, camera: 'map', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod: 0, ...over });
const run = (g: KnowledgeGraph, m: StageModel, r: PlacementReq): Placement => { const t = PLACEMENTS.map(g, m, r); while (!t.step()); return t.result(); };
const family = (p: Placement, f: LinkBatch['family']) => p.links.find((b) => b.family === f);
/** Each polyline's first segment index (a NaN point ends a polyline; its segment count is points − 1). */
function firstSegments(b: LinkBatch): number[] {
    const out: number[] = [];
    let seg = 0, start = true;
    for (let i = 0; i < b.runLength.length; i++) {
        if (Number.isNaN(b.points[i * 3]!)) { start = true; continue; }
        if (start) { out.push(seg); start = false; continue; }
        seg++;
    }
    return out;
}

const graph = withDocs();
const model = buildStageModel(graph, []);
const map = run(graph, model, req(model));

describe('Map hops (was HopPath)', () => {
    const routes = family(map, 'route')!;
    const starts = firstSegments(routes);

    it('draws a background casing under every route, wider than the line', () => {
        expect(routes.casing).toEqual({ tone: BG_TONE, extra: 4 });
    });

    it('dashes an untested hop 9/7 in the violation tone and draws a tested one solid in its line\'s tone', () => {
        let untested = 0;
        routes.lineIds!.forEach((_, g) => {
            const seg = starts[g]!;
            if (routes.dash[seg] === DASH_UNTESTED) { untested++; expect(routes.tone[seg]).toBe(toneIndex('violation')); }
            else expect(routes.dash[seg]).toBe(DASH_SOLID);
        });
        // The fixture has a hop no test reaches: the fact is live.
        const any = model.lines.lines.some((l) => l.hops.some((h) => segmentUntested(model.stations.byId.get(h.from)!, model.stations.byId.get(h.to)!) === true));
        expect(untested > 0).toBe(any);
    });

    it('marks a cycle hop by shape: dashed 3/5, not by colour alone', () => {
        const cyc: StageModel = { ...model, lines: { ...model.lines, lines: model.lines.lines.map((l, i) => (i === 0 ? { ...l, hops: l.hops.map((h) => ({ ...h, cycle: true })) } : l)) } };
        const p = run(graph, cyc, req(cyc));
        const b = family(p, 'route')!;
        const first = model.lines.lines[0]!.id;
        const dashes = firstSegments(b).filter((_, g) => b.lineIds![g] === first).map((seg) => b.dash[seg]);
        expect(dashes.length).toBeGreaterThan(0);
        for (const d of dashes) expect([DASH_CYCLE, DASH_UNTESTED]).toContain(d);
        expect(dashes).toContain(DASH_CYCLE);
    });
});

describe('Map walls and documents (was TransitBands and DescribeLinks)', () => {
    it('draws the HTTP boundary wall where a hop enters a station serving routes, dashed 5/4', () => {
        const wall = family(map, 'wall')!;
        expect(wall).toBeTruthy();
        expect([...wall.dash].every((d) => d === DASH_WALL)).toBe(true);
    });

    it('draws a document station in the doc type and a dashed describes link from it to the code', () => {
        const doc = model.stations.stations.find((s) => s.name === 'docs')!;
        const slot = model.stationSlot.get(doc.id)!;
        expect(MARK_TYPE_ORDER[model.marks.type[slot]!]).toBe('doc');
        const api = model.stations.stations.find((s) => s.name === 'API')!;
        expect(MARK_TYPE_ORDER[model.marks.type[model.stationSlot.get(api.id)!]!]).not.toBe('doc');
        const paint = paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: null });
        expect(paint.flags[slot]! & FLAG.DOC).toBe(FLAG.DOC);
        const describes = family(map, 'describes')!;
        expect(describes.dash.length).toBeGreaterThan(0);
        expect([...describes.dash].every((d) => d === DASH_DESCRIBES)).toBe(true);
    });

    it('a graph with no documents and no routes served draws neither', () => {
        const plain = surfaceFixture();
        const noRoutes: KnowledgeGraph = { ...plain, nodes: plain.nodes.map((n) => {
            if (!n.badges?.routes) return n;
            const { routes: _served, ...badges } = n.badges;
            return { ...n, badges };
        }) };
        const m = buildStageModel(noRoutes, []);
        const p = run(noRoutes, m, req(m));
        expect(family(p, 'describes')).toBeUndefined();
        expect(family(p, 'wall')).toBeUndefined();
    });
});

describe('Map station paint (was StationMark)', () => {
    for (const preset of ['risk', 'quality'] as const) {
        it(`${preset}: the interchange backing, the coverage arc, the shell, the pulse and the outline come from the overlay`, () => {
            const paint = paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS[preset], lit: null, roles: null });
            const overlay = makeOverlay(PRESETS[preset], model.stations.stations);
            for (const s of model.stations.stations) {
                const slot = model.stationSlot.get(s.id)!, st = overlay.style(s), f = paint.flags[slot]!;
                expect(paint.tone[slot]).toBe(toneIndex(st.tone));
                expect(!!(f & FLAG.INTERCHANGE)).toBe(model.lines.lines.filter((l) => l.stops.includes(s.id)).length > 1);
                expect(!!(f & FLAG.SHELL)).toBe(st.ring?.zeroCoverage === true);
                expect(!!(f & FLAG.PULSE)).toBe(st.pulse);
                expect(!!(f & FLAG.OUTLINE)).toBe(st.outline);
                if (st.ring) { expect(paint.tone2[slot]).toBe(toneIndex(st.ring.tone)); expect(paint.fill[slot]).toBeCloseTo(st.ring.frac); }
            }
        });
    }

    it('dims a station off the answer, and keeps the answer lit', () => {
        const [on, ...off] = model.stations.stations;
        const paint = paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: [on!.id], roles: null });
        expect(paint.flags[model.stationSlot.get(on!.id)!]! & FLAG.DIM).toBe(0);
        for (const s of off) expect(paint.flags[model.stationSlot.get(s.id)!]! & FLAG.DIM).toBe(FLAG.DIM);
    });
});

describe('towers (was TowerMark and the Map\'s towers look)', () => {
    it('stands 14 + 16 per level tall, from level 1 to 5, and a middling tower when the channel has no reading', () => {
        expect(towerHeight(5 + 1 * 2)).toBe(30);
        expect(towerHeight(5 + 3 * 2)).toBe(62);
        expect(towerHeight(5 + 5 * 2)).toBe(94);
        expect(towerHeight(8)).toBe(46);
    });

    it('reads the station\'s complexity level for a neutral tower, and ignores it once the size channel has a reading', () => {
        expect(towerHeight(8, 5)).toBe(94);
        expect(towerHeight(8, 1)).toBe(30);
        expect(towerHeight(5 + 1 * 2, 5)).toBe(30);
    });

    it('the tilted Map raises the SAME stations the flat one shows, each by its tower height', () => {
        const flat = run(graph, model, req(model, { depth: 0 })), tall = run(graph, model, req(model, { depth: 1 }));
        expect(tall.a11y.map((a) => a.slot)).toEqual(flat.a11y.map((a) => a.slot));
        const neutral = makeOverlay(channelBindings(), model.stations.stations);
        for (const { slot } of tall.a11y) {
            const s = model.stations.stations.find((x) => model.stationSlot.get(x.id) === slot)!;
            expect(flat.extrude[slot]).toBe(0);
            expect(tall.extrude[slot]).toBe(towerHeight(neutral.style(s).size, s.cx));
        }
    });

    it('lights an anti-pattern highlight: the offender in the violation tone, the partner in the partner tone, every other node dimmed', () => {
        const files = graph.nodes.filter((n) => n.kind === 'file');
        const [offender, partner, ...rest] = files;
        const paint = paintMarks(graph, model, { lensId: 'structure', overlay: PRESETS.risk, lit: null, roles: [[offender!.ref, 'offender'], [partner!.ref, 'partner']] });
        const slot = (ref: string) => model.nodeSlot.get(ref)!;
        expect(paint.tone[slot(offender!.ref)]).toBe(toneIndex(ROLE_TONE.offender));
        expect(paint.tone[slot(partner!.ref)]).toBe(toneIndex(ROLE_TONE.partner));
        expect(paint.flags[slot(offender!.ref)]! & FLAG.DIM).toBe(0);
        expect(paint.flags[slot(rest[0]!.ref)]! & FLAG.DIM).toBe(FLAG.DIM);
    });
});
