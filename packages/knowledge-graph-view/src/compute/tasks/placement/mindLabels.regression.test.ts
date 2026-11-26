/**
 * Regressions from the VS Code webview's Mind map on a real repo (~30k files): the tree edges drew but NO name showed —
 * not the root's, not a folder's. The placement laid the radial tree into one viewport band, so on a big tree a branch's
 * mark is under a pixel at the home zoom, and the label LOD (which shows a run once its MARK is a few px across) dropped
 * every run. A Mind map name is chosen by ROOM (the SVG mind map's `labelFitsAt`), never by its dot's size; and the
 * dots themselves were a pixel or two: the placement now declares the SVG's least dot as its `minMarkPx` floor.
 */

import { describe, expect, it } from 'vitest';
import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DEFAULT_KNOWLEDGE_GRAPH_LABELS as L } from '../../../labels';
import { codeFixture } from '../../../testing';
import { fitView } from '../../../stage/projection';
import { placeLabels } from '../../../stage/labels/runs';
import { MIN_BRANCH_RADIUS_PX } from '../../../map/mindLayout';
import { drawnHalfPx, slotHalfPx } from '../../../stage/markSize';
import { MarkLayer } from '../../../stage/marks/MarkLayer';
import { sharedMarkUniforms } from '../../../stage/marks/shader';
import { createStats } from '../../../stage/stats';
import type { Placement } from '../../../stage/types';
import { buildStageModel } from '../stageModel';
import { dirKey } from '../markSet';
import { PLACEMENTS, viewportBandOf, type PlacementReq } from './index';

const file = (path: string): KNode => ({ ref: `src:r::${path}` as KNode['ref'], kind: 'file', label: path, pack: 'code', importance: 0.5, origin: 'extracted' });
const STRINGS = { mapMore: L.mapMore, 'mind.moreFoldersOne': L.surface.mind.moreFoldersOne, 'mind.moreFoldersOther': L.surface.mind.moreFoldersOther };

/** A big repo: 40 top folders, the 6 largest with 40 subfolders (the map opens those), the rest 3; 10 sub-subfolders × 8 files each. */
function bigRepo(): KnowledgeGraph {
    const nodes: KNode[] = [];
    for (let a = 0; a < 40; a++) for (let b = 0; b < (a < 6 ? 40 : 3); b++) for (let c = 0; c < 10; c++) for (let f = 0; f < 8; f++) nodes.push(file(`top${a}/sub${b}/leaf${c}/f${f}.ts`));
    return { ...codeFixture('r'), nodes, edges: [], findings: [] };
}

// The reported panel: ~890px wide, the scene box ~480px tall below the overlay.
const BOX = { width: 860, height: 480 };

describe('the Mind map names on a big repo', () => {
    const g = bigRepo();
    const model = buildStageModel(g, STRINGS);
    const req: PlacementReq = { graph: 1, generation: model.marks.generation, camera: 'mind', drill: null, unfolded: null, pins: [], pathId: null, viewportBand: viewportBandOf(BOX.width), lod: 0 };
    const t = PLACEMENTS.mind(g, model, req);
    while (!t.step());
    const p: Placement = t.result();
    const home = fitView(p.bounds, BOX.width, BOX.height).zoom;
    const shownSlots = (pxPerWorld: number): Set<number> => {
        const placed = placeLabels(p.labels, p, { pxPerWorld, depth: 0 }, true);
        return new Set([...placed.sdf.map((l) => l.slot), ...placed.dom.map((c) => p.labels.find((r) => r.text === c.text)?.slot ?? -1)]);
    };

    it('regression: the root and the folders with room are named at the home zoom (no name showed at all)', () => {
        const root = model.marks.keys.indexOf(dirKey(''));
        // The repro: the root's own mark is under the LOD's 4px at home, so a mark-size gate drops even the root's name.
        expect(2 * p.scale[root]! * home).toBeLessThan(4);
        const shown = shownSlots(home);
        expect(shown.has(model.marks.keys.indexOf(dirKey('')))).toBe(true);
        const folders = p.labels.filter((r) => model.marks.keys[r.slot]!.startsWith('dir:') && r.slot !== model.marks.keys.indexOf(dirKey('')));
        expect([...shown].filter((s) => folders.some((r) => r.slot === s)).length).toBeGreaterThan(0);
    });

    it('regression: zooming in names more branches (room grows with the zoom, as in the SVG mind map)', () => {
        expect(shownSlots(home * 4).size).toBeGreaterThan(shownSlots(home).size);
    });

    it('regression: every run\'s priority stays in the LOD contract\'s 0..1', () => {
        for (const r of p.labels) { expect(r.priority).toBeGreaterThanOrEqual(0); expect(r.priority).toBeLessThanOrEqual(1); }
    });

    it('regression: the root and every folder are DRAWN at least the SVG mind map\'s least dot at the home zoom (they were 1–3px)', () => {
        const root = model.marks.keys.indexOf(dirKey(''));
        expect(p.minMarkPx).toBe(2 * MIN_BRANCH_RADIUS_PX);
        expect(2 * p.scale[root]! * home).toBeLessThan(p.minMarkPx!); // the repro: its world size alone is under the floor
        for (const a of p.a11y) expect(2 * slotHalfPx(p, a.slot, home)).toBeGreaterThanOrEqual(2 * MIN_BRANCH_RADIUS_PX);
    });

    it('regression: the floor rides with its placement SET, so a Graph ↔ Mind tween blends it instead of jumping at t=0', () => {
        const gt = PLACEMENTS.graph(g, model, { ...req, camera: 'graph' });
        while (!gt.step());
        const graph = gt.result();
        expect(graph.minMarkPx).toBeUndefined(); // other cameras keep their world-size marks
        const uniforms = sharedMarkUniforms(), layer = new MarkLayer(createStats(), uniforms);
        layer.setMarks(model.marks);
        // The shader reads set A's floor in x and B's in y; uFlip picks which set a tween runs from.
        const fromTo = (flip: number): [number, number] => {
            const v = uniforms.uMinMarkPx.value;
            return flip ? [v.y, v.x] : [v.x, v.y];
        };
        layer.setPlacement(graph);
        expect(fromTo(0)).toEqual([0, 0]);
        // Graph → Mind: the outgoing Graph marks keep no floor; only the Mind set carries the 6px.
        expect(fromTo(layer.setPlacement(p))).toEqual([0, p.minMarkPx]);
        // Mind → Graph: the Mind dots start at their floor and the Graph set ends with none — no snap to world size at t=0.
        expect(fromTo(layer.setPlacement(graph))).toEqual([p.minMarkPx, 0]);
        // A retarget mid-tween bakes the floor like the sets: the stale set gets the blend reached at t.
        expect(fromTo(layer.setPlacement(p, 0.25))).toEqual([p.minMarkPx! * 0.75, p.minMarkPx]);
        layer.dispose();
    });

    it('a hidden mark stays hidden under the floor; with none a mark is its world size', () => {
        expect(drawnHalfPx(0, 1, 6)).toBe(0);
        expect(drawnHalfPx(0.5, 1)).toBe(0.5);
        expect(drawnHalfPx(0.5, 1, 6)).toBe(3);
    });
});
