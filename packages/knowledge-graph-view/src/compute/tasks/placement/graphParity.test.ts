/**
 * The Graph placement against the 2D graph (PRD 43 P3 parity): the same layout, the same drawn edges (as singles and
 * bundles), the same captions per zoom band, no overlapping labels, and a camera switch that creates no mesh. The 2D
 * graph's reference is computed here from its own pure modules (`layout2d`, the ONE edge ranking, `edgePaths`,
 * `placeCaptions`), exactly as `Graph2D.tsx` composes them.
 */

import { describe, expect, it } from 'vitest';
import { InstancedMesh, type Object3D } from 'three';
import type { KEdge, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { bandCaption, placeCaptions, type CaptionCandidate, type PlacedCaption } from '../../../graph2d/captionPlacement';
import { pathsOf } from '../../../graph2d/edgePaths';
import { layout2d, nodeRadius, type Layout2D } from '../../../graph2d/layout2d';
import { byImportance, focusGraph } from '../../../graphModel';
import { LINE_EM, textWidth } from '../../../map/labelBudget';
import { buildPerfGraph } from '../../../perf/syntheticGraph';
import { placementLabel } from '../../../placement';
import { edgeBucket, groupEdges } from '../../../scene/buffers';
import { pickEdges, rankEdges } from '../../../scene/edgeBudget';
import { fixedFontPort } from '../../../stage/fonts';
import type { LabelText, TextPort } from '../../../stage/labels/LabelLayer';
import { CAPTION_FONT_PX, CAPTION_GAP_EM, CAPTION_ZOOM_BANDS } from '../../../stage/labels/lod';
import { placeLabels } from '../../../stage/labels/runs';
import { LINK_FAMILY_STYLE } from '../../../stage/links/families';
import { createWebGLStage } from '../../../stage/renderer';
import { SLOT_NODE, type Placement } from '../../../stage/types';
import { surfaceFixture } from '../../../testing';
import { withSymbols } from '../../../surface/transit/testFixtures';
import { FONT_PX } from '../../../useSvgScale';
import { bundleEdges } from '../bundle';
import { buildStageModel, type StageModel } from '../stageModel';
import { graphFrameOf, placementWordsOf } from './graph';
import { GRAPH_LOD, graphEdgeLinks, segmentsOf } from './graphEdges';
import { PLACEMENTS, type PlacementReq } from './index';

const req = (model: StageModel, camera: PlacementReq['camera'], lod = 0): PlacementReq =>
    ({ graph: 1, generation: model.marks.generation, camera, drill: null, unfolded: null, pins: [], pathId: null, viewportBand: 2, lod });
const place = (g: KnowledgeGraph, model: StageModel, camera: PlacementReq['camera'], lod = 0): Placement => {
    const t = PLACEMENTS[camera](g, model, req(model, camera, lod)); while (!t.step()); return t.result();
};

const small = withSymbols(surfaceFixture());
const smallModel = buildStageModel(small, []);
// A graph past the 2,000 cap with far more edges than the singles budget: bundles, hidden nodes.
const big = buildPerfGraph({ scale: 0.75 }).graph;
const bigModel = buildStageModel(big, []);

/** The 2D graph's own pipeline for `g`'s focus cut. */
function reference(g: KnowledgeGraph, cap = 2000) {
    const shown = focusGraph(g, cap, []);
    const layout = layout2d(g.scope.rootId, shown.nodes, shown.edges);
    const drawn = pickEdges(rankEdges(shown.edges, shown.nodes), null);
    return { shown, layout, drawn };
}

/** The 2D graph's `Captions` for no selection at zoom `pxPerLayout` (CSS px per layout unit), the first `names` nodes. */
function graph2dCaptions(g: KnowledgeGraph, model: StageModel, layout: Layout2D, nodes: ReturnType<typeof reference>['shown']['nodes'], pxPerLayout: number, names: number): PlacedCaption[] {
    const font = FONT_PX / pxPerLayout;
    const markRadius = (importance: number) => Math.max(nodeRadius(importance), (font * 3) / FONT_PX);
    const candidates: CaptionCandidate[] = [...nodes].sort(byImportance).slice(0, names).flatMap((n) => {
        const p = layout.positions.get(n.ref);
        return p ? [{ ref: n.ref, x: p[0], y: p[1], r: markRadius(n.importance), text: n.label }] : [];
    });
    const words = placementWordsOf(model.strings);
    const obstacles = layout.bands.map((b) => bandCaption(b, layout.bounds, font, placementLabel(b.partition, g, words)).box);
    return placeCaptions(candidates, font, obstacles);
}

const segmentsCount = (d: string): number => d.split('M').length - 1;

describe('Graph placement parity with the 2D graph (PRD 43 P3)', () => {
    it('places every shown node at its 2D layout position, sized by nodeRadius', () => {
        const p = place(small, smallModel, 'graph');
        const { layout } = reference(small);
        const f = graphFrameOf(layout, 2);
        expect(layout.positions.size).toBeGreaterThan(0);
        for (const [ref, [x, y]] of layout.positions) {
            const slot = smallModel.nodeSlot.get(ref)!;
            expect(p.position[slot * 3]).toBe(Math.fround(f.x(x)));
            expect(p.position[slot * 3 + 2]).toBe(Math.fround(f.z(y)));
            expect(p.scale[slot]).toBeCloseTo(nodeRadius(small.nodes[slot]!.importance) * f.k, 4);
        }
        expect(p.a11y.length).toBe(layout.positions.size);
    });

    it('accounts for every edge the 2D graph draws: singles + bundled members + hidden = drawn, per tone bucket', () => {
        const p = place(big, bigModel, 'graph');
        const { drawn, layout } = reference(big);
        const ref2d = pathsOf(groupEdges(drawn, (r) => layout.positions.get(r)));
        const perBucket2d = new Map(ref2d.map((g) => [g.bucket, segmentsCount(g.d)] as const));
        const total2d = [...perBucket2d.values()].reduce((a, b) => a + b, 0);
        expect(total2d).toBeGreaterThan(GRAPH_LOD[0]!.singles); // bundling is exercised

        const aggregateOf = (r: string) => { const s = bigModel.nodeSlot.get(r); if (s === undefined || !(p.scale[s]! > 0)) return undefined; const st = bigModel.marks.parentStation[s]!; return st >= 0 ? st : s; };
        const all = bundleEdges(drawn, aggregateOf, { singles: 0, bundles: Number.MAX_SAFE_INTEGER });
        const intra = drawn.filter((e) => { const a = aggregateOf(e.from), b = aggregateOf(e.to); return a !== undefined && a === b; }).length;
        // With no singles and no cut, bundles + intra-aggregate edges are exactly the 2D graph's drawn edges, bucket by bucket.
        const perBucket = new Map<string, number>();
        for (const k of all.bundles) perBucket.set(k.bucket, (perBucket.get(k.bucket) ?? 0) + k.count);
        for (const e of drawn) { const a = aggregateOf(e.from), b = aggregateOf(e.to); if (a !== undefined && a === b) { const k = edgeBucket(e).bucket; perBucket.set(k, (perBucket.get(k) ?? 0) + 1); } }
        expect(perBucket).toEqual(perBucket2d);
        expect(all.drawn + all.hidden).toBe(total2d);
        expect(all.hidden).toBe(intra);

        // The placement at LOD 0: drawn + hidden = the 2D graph's drawn edges; the batch fits the family.
        const lod = bundleEdges(drawn, aggregateOf, GRAPH_LOD[0]!);
        expect(lod.drawn + lod.hidden).toBe(total2d);
        expect(p.caption.edges).toEqual({ shown: lod.drawn, total: rankEdges(focusGraph(big, 2000, []).edges, focusGraph(big, 2000, []).nodes).total, capped: true });
        const batch = p.links[0]!;
        expect(batch.family).toBe('edge');
        expect(batch.tone.length).toBeLessThanOrEqual(LINK_FAMILY_STYLE.edge.capacity);
        const perGroup = new Map<number, number>();
        batch.group.forEach((g, s) => perGroup.set(g, batch.aggregate![s]!));
        expect([...perGroup.values()].reduce((a, b) => a + b, 0)).toBe(lod.drawn);
        expect(perGroup.size).toBe(lod.singles.length + lod.bundles.length);
    });

    it('routes each single between its two nodes and each bundle between its two aggregates\' hubs', () => {
        const p = place(big, bigModel, 'graph');
        const { drawn } = reference(big);
        const at = (slot: number) => [p.position[slot * 3]!, p.position[slot * 3 + 2]!] as const;
        const aggregateOf = (r: string) => { const s = bigModel.nodeSlot.get(r); if (s === undefined || !(p.scale[s]! > 0)) return undefined; const st = bigModel.marks.parentStation[s]!; return st >= 0 ? st : s; };
        const budget = { singles: 40, bundles: 12 };
        const b = bundleEdges(drawn, aggregateOf, budget);
        expect(b.singles.length).toBe(40);
        expect(b.bundles.length).toBe(12);
        // Bundles are the top by count, each counting the drawn non-single edges between its two aggregates in its bucket.
        const singles = new Set<KEdge>(b.singles);
        for (const k of b.bundles) {
            const members = drawn.filter((e) => {
                if (singles.has(e) || edgeBucket(e).bucket !== k.bucket) return false;
                const x = aggregateOf(e.from), y = aggregateOf(e.to);
                return x !== undefined && y !== undefined && Math.min(x, y) === k.a && Math.max(x, y) === k.b;
            });
            expect(members.length).toBe(k.count);
        }
        for (let i = 1; i < b.bundles.length; i++) expect(b.bundles[i - 1]!.count).toBeGreaterThanOrEqual(b.bundles[i]!.count);
        const batch = graphEdgeLinks(b, (r) => { const s = bigModel.nodeSlot.get(r); return s === undefined ? undefined : at(s); }, at);
        const ends = new Map<number, [number[], number[]]>();
        for (let i = 0, g = 0, start = 0; i < batch.points.length / 3; i++) {
            if (Number.isNaN(batch.points[i * 3]!)) { ends.set(g, [[batch.points[start * 3]!, batch.points[start * 3 + 2]!], [batch.points[(i - 1) * 3]!, batch.points[(i - 1) * 3 + 2]!]]); g++; start = i + 1; }
        }
        b.singles.forEach((e, g) => {
            const [a, z] = ends.get(g)!;
            expect(a).toEqual([...at(bigModel.nodeSlot.get(e.from)!)].map((v) => Math.fround(v)));
            expect(z).toEqual([...at(bigModel.nodeSlot.get(e.to)!)].map((v) => Math.fround(v)));
        });
        b.bundles.forEach((k, i) => {
            const [a, z] = ends.get(b.singles.length + i)!;
            at(k.a).forEach((v, j) => expect(a[j]).toBeCloseTo(v, 2));
            at(k.b).forEach((v, j) => expect(z[j]).toBeCloseTo(v, 2));
            // A station hub is the centroid of its shown members (where the hidden station slot sits, at scale 0).
            if (bigModel.marks.slotKind[k.a] !== SLOT_NODE) expect(p.scale[k.a]).toBe(0);
        });
    });

    it('every LOD band fits the edge family, and hidden nodes past the cap sit at their aggregate at scale 0', () => {
        for (const band of GRAPH_LOD) expect(segmentsOf(band)).toBeLessThanOrEqual(LINK_FAMILY_STYLE.edge.capacity);
        const p = place(big, bigModel, 'graph');
        expect(p.a11y.length).toBe(2000);
        expect(big.nodes.length).toBeGreaterThan(2000);
        let hidden = 0;
        big.nodes.forEach((_, slot) => {
            if (p.scale[slot]! > 0) return;
            hidden++;
            const st = bigModel.marks.parentStation[slot]!;
            if (st >= 0 && p.a11y.some((a) => bigModel.marks.parentStation[a.slot] === st)) {
                expect([0, 1, 2].map((k) => p.position[slot * 3 + k])).toEqual([0, 1, 2].map((k) => p.position[st * 3 + k]));
            }
            for (let k = 0; k < 3; k++) expect(Number.isFinite(p.position[slot * 3 + k]!)).toBe(true);
        });
        expect(hidden).toBe(big.nodes.length - 2000);
        const all = place(big, bigModel, 'graph', 1);
        expect(all.a11y.length).toBe(big.nodes.length);
        expect(all.links[0]!.tone.length).toBeLessThanOrEqual(LINK_FAMILY_STYLE.edge.capacity);
    });

    it('chooses the 2D graph\'s captions at each zoom band', () => {
        expect(CAPTION_FONT_PX).toBe(FONT_PX);
        for (const [g, model] of [[small, smallModel], [big, bigModel]] as const) {
            const p = place(g, model, 'graph');
            const { layout, shown } = reference(g);
            const f = graphFrameOf(layout, 2);
            CAPTION_ZOOM_BANDS.forEach((band) => {
                const px = Math.max(band.minPx, 1e-3);
                const active = new Map(p.labels.filter((r) => r.zoomPx && px >= r.zoomPx[0] && px < r.zoomPx[1]).map((r) => [model.marks.keys[r.slot]!.slice('node:'.length), r.anchor] as const));
                // At the band's near end the stage shows exactly the 2D graph's captions, each on the same side.
                const ref = graph2dCaptions(g, model, layout, shown.nodes, px * f.k, band.names);
                expect(ref.length).toBeGreaterThan(0);
                expect(active).toEqual(new Map(ref.map((c) => [c.ref, c.anchor] as const)));
            });
        }
    });

    it('no two placed labels overlap at any zoom of any band', () => {
        for (const [g, model] of [[small, smallModel], [big, bigModel]] as const) {
            const p = place(g, model, 'graph');
            for (const band of CAPTION_ZOOM_BANDS) {
                const far = Number.isFinite(band.maxPx) ? band.maxPx * 0.999 : band.minPx * 4;
                for (const px of [Math.max(band.minPx, 0.25), (Math.max(band.minPx, 0.25) + far) / 2, far]) {
                    const { sdf, dom } = placeLabels(p.labels, p, { pxPerWorld: px, depth: 0 }, true);
                    const font = CAPTION_FONT_PX / px, h = font * LINE_EM;
                    const boxes = [
                        ...sdf.map((l) => ({ x: l.anchorX === 'left' ? l.position[0] : l.position[0] - textWidth(l.text.length, font), y: l.position[2], w: textWidth(l.text.length, font), h })),
                        ...dom.map((c) => ({ x: c.anchor === 'start' ? c.position[0] : c.position[0] - textWidth(c.text.length, font), y: c.position[2], w: textWidth(c.text.length, font), h })),
                    ];
                    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
                        const a = boxes[i]!, b = boxes[j]!;
                        const hit = a.x < b.x + b.w - 1e-6 && b.x < a.x + a.w - 1e-6 && a.y < b.y + b.h - 1e-6 && b.y < a.y + a.h - 1e-6;
                        expect(hit, `labels ${i} and ${j} overlap at ${px} px/unit`).toBe(false);
                    }
                }
            }
        }
    });

    it('band titles follow the 2D graph\'s band caption boxes at every zoom, and no name overlaps them', () => {
        for (const [g, model] of [[small, smallModel], [big, bigModel]] as const) {
            const p = place(g, model, 'graph');
            const { layout } = reference(g);
            const f = graphFrameOf(layout, 2);
            const bounds = { minX: f.x(layout.bounds.minX), maxX: f.x(layout.bounds.maxX), minY: f.z(layout.bounds.minY), maxY: f.z(layout.bounds.maxY) };
            const titles = p.captions.filter((c) => c.role === 'band');
            expect(titles.length).toBe(layout.bands.length);
            for (const px of [0.3, 0.75, 1, 1.7, 3, 6, 12]) {
                const font = CAPTION_FONT_PX / px, h = font * LINE_EM;
                const boxes = titles.map((c, i) => {
                    // Where the DOM layer draws it: the world point, plus the px offset at this zoom, centred vertically.
                    const box = { x: c.position[0] + c.offsetPx![0] / px, y: c.position[2] + c.offsetPx![1] / px - h / 2, w: textWidth(c.text.length, font), h };
                    const band = layout.bands[i]!;
                    const want = bandCaption({ partition: band.partition, top: f.z(band.top), height: band.height * f.k }, bounds, font, c.text).box;
                    (['x', 'y', 'w', 'h'] as const).forEach((k) => expect(box[k]).toBeCloseTo(want[k], 4));
                    return box;
                });
                const { sdf, dom } = placeLabels(p.labels, p, { pxPerWorld: px, depth: 0 }, true);
                const names = [
                    ...sdf.map((l) => ({ x: l.anchorX === 'left' ? l.position[0] : l.position[0] - textWidth(l.text.length, font), y: l.position[2], w: textWidth(l.text.length, font), h })),
                    ...dom.map((c) => ({ x: c.anchor === 'start' ? c.position[0] : c.position[0] - textWidth(c.text.length, font), y: c.position[2], w: textWidth(c.text.length, font), h })),
                ];
                for (const t of boxes) for (const n of names) {
                    const hit = t.x < n.x + n.w - 1e-6 && n.x < t.x + t.w - 1e-6 && t.y < n.y + n.h - 1e-6 && n.y < t.y + t.h - 1e-6;
                    expect(hit, `a name overlaps a band title at ${px} px/unit`).toBe(false);
                }
            }
        }
    });

    it('a caption sits beside its mark: the mark radius in world units plus the gap in px, centred vertically', () => {
        const p = place(small, smallModel, 'graph');
        const run = p.labels[0]!;
        const px = Math.max(run.zoomPx![0], 1);
        const { sdf } = placeLabels([run], p, { pxPerWorld: px, depth: 0 }, true);
        const side = run.anchor === 'start' ? 1 : -1;
        const x = p.position[run.slot * 3]! + side * (p.scale[run.slot]! + (CAPTION_GAP_EM * CAPTION_FONT_PX) / px);
        if (sdf[0]) {
            expect(sdf[0].position[0]).toBeCloseTo(x, 4);
            expect(sdf[0].position[2]).toBeCloseTo(p.position[run.slot * 3 + 2]! - (CAPTION_FONT_PX * LINE_EM) / 2 / px, 4);
        }
    });
});

const textPort = (): TextPort => ({
    object: null,
    create: () => ({ text: '', font: null, fontSize: 0, anchorX: 0, color: null, outlineWidth: 0, outlineColor: 0, fillOpacity: 1, outlineOpacity: 1, position: { set() {} }, dispose() {} } as LabelText),
    add() {}, remove() {}, dispose() {},
});
const markMeshes = (root: Object3D): number => { let n = 0; root.traverse((o) => { if (o instanceof InstancedMesh && o.name.startsWith('marks:')) n++; }); return n; };

describe('a switch to the Graph camera (PRD 43 done check: 0 meshes, ≤ 3 uploads per batch)', () => {
    it.each([['small', small, smallModel], ['past the cap', big, bigModel]] as const)('map → graph → map (%s) creates no mesh and uploads ≤ 3 times per mark batch', (_name, g, model) => {
        const stage = createWebGLStage({ text: textPort, fonts: fixedFontPort({}) });
        stage.setMarks(model.marks);
        const map = place(g, model, 'map'), graph = place(g, model, 'graph');
        stage.setPlacement(map, 0, 0);
        const created = stage.stats.meshesCreated, batches = markMeshes(stage.object!);
        expect(batches).toBe(model.marks.batches.length);
        const before = stage.stats.uploads;
        stage.setPlacement(graph, 0, 400); while (stage.tick(10_000));
        expect(stage.stats.meshesCreated).toBe(created);
        expect(stage.stats.uploads - before).toBeLessThanOrEqual(3 * batches);
        stage.setPlacement(map, 20_000, 400); while (stage.tick(30_000));
        expect(stage.stats.meshesCreated).toBe(created);
        expect(markMeshes(stage.object!)).toBe(batches);
    });
});
