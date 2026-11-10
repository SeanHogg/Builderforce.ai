/**
 * The Graph placement (PRD 43 B2 Graph row, P3) from the EXISTING `layout2d` output (B1a rule 4) — the layout is not
 * rewritten, only read, so every node stands where the 2D graph stands it:
 *
 *   - the focused nodes (the same `focusGraph` cut, at the LOD band's cap: `GRAPH_LOD`) at their 2D layout positions,
 *     scaled into the viewport band's width (layout y → world z), sized by `nodeRadius`;
 *   - every hidden node at scale 0 at its aggregate: its station (the centroid of the station's shown members), else its
 *     community / partition band's centroid; every station at that centroid (`anchorHidden`);
 *   - the placement bands as planes, captioned by `placementLabel`;
 *   - the edges: the 2D graph's drawn set, split into singles and station-to-station bundles per the LOD band
 *     (`bundle.ts`, `graphEdges.ts`), never past the `edge` family's capacity;
 *   - the node captions per zoom band, collision-free through the 2D graph's `placeCaptions` (`graphCaptions.ts`).
 *
 * Selection stays out (rule 6). A stepping task: the layout and the edge ranking yield between slices. Pure.
 */

import type { KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { layout2dTask, nodeRadius, type Band, type Bounds, type Layout2D } from '../../../graph2d/layout2d';
import { byImportance, focusGraph } from '../../../graphModel';
import { placementLabel, planeKeyOf, type PlacementWords } from '../../../placement';
import { MAX_DRAWN_EDGES, pickEdges, rankTask, type RankedEdges } from '../../../scene/edgeBudget';
import { NONE_PARTITION } from '../../../scene/planeOrder';
import type { IdleTask } from '../../../useIdleSteps';
import { CAPTION_ZOOM_BANDS } from '../../../stage/labels/lod';
import { toneIndex } from '../../../stage/tones';
import type { Caption, LabelRun, Placement, PlaneSpec } from '../../../stage/types';
import { bundleEdges, type BundleBudget, type BundledEdges } from '../bundle';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, hide, show, VISIBLE, type Draft } from './anchor';
import { bandTitleCaption, graphCaptionRuns, type BandTitle, type GraphCaptionNode } from './graphCaptions';
import { graphEdgeLinks, graphLodOf, GRAPH_LOD } from './graphEdges';
import { placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

/** Nodes the Graph camera shows per LOD band (`GRAPH_LOD`): band 0 is today's 2,000-node cap; band 1 every node. */
export const GRAPH_SHOWN_BY_LOD: readonly number[] = GRAPH_LOD.map((b) => b.shown);
const MARGIN = 24;

/**
 * The label keys `placementLabel` needs; the main thread copies them from its labels into the markSet request's `strings`
 * (the worker has no labels object). A missing word reads as empty, never as an invented English one.
 */
export const PLACEMENT_WORD_KEYS = ['partitionNone', 'communityFallback', 'communityOther'] as const satisfies readonly (keyof PlacementWords)[];

export const placementWordsOf = (strings: Readonly<Record<string, string>>): PlacementWords => ({
    partitionNone: strings.partitionNone ?? '', communityFallback: strings.communityFallback ?? '', communityOther: strings.communityOther ?? '',
});
const BAND_TONES = [toneIndex('plane'), toneIndex('bg')];
/** The most names any zoom band captions (the last band's). */
const MAX_NAMES = Math.max(...CAPTION_ZOOM_BANDS.map((b) => b.names));

export function placeGraph(g: KnowledgeGraph, model: StageModel, req: PlacementReq): IdleTask<Placement> {
    const band = graphLodOf(req.lod);
    const shown = focusGraph(g, band.shown, []);
    const task = layout2dTask(g.scope.rootId, shown.nodes, shown.edges);
    let rank: IdleTask<RankedEdges> | null = null;
    // After the layout and the ranking, the tail runs one slice per step (nodes, edges, captions), so no single step
    // holds the worker for the whole assembly.
    let nodes: PlacedNodes | null = null, edges: BundledEdges | null = null, labels: LabelRun[] | null = null;
    let built: Placement | null = null;
    const placed = () => (nodes ??= placeNodes(g, model, req, shown.nodes, task.result()));
    const bundled = () => (edges ??= bundleFor(model, placed(), rank!.result(), band));
    const runs = () => (labels ??= captionRunsFor(model, placed(), shown.nodes));
    return {
        step: () => {
            if (!task.step()) return false;
            rank ??= rankTask(shown.edges, shown.nodes);
            if (!rank.step()) return false;
            if (!nodes) { placed(); return false; }
            if (!edges) { bundled(); return false; }
            runs();
            return true;
        },
        result: () => (built ??= assemble(model, req, placed(), bundled(), runs(), rank!.result().total)),
    };
}

/** Layout units → world: x from the layout's left, z from its top, one scale `k` fitted into the band's width. */
export interface GraphFrame { k: number; width: number; height: number; x(v: number): number; z(v: number): number }

export function graphFrameOf(layout: Layout2D, viewportBand: number): GraphFrame {
    const width = VIEWPORT_BANDS[viewportBand] ?? VIEWPORT_BANDS[2]!;
    const b = layout.bounds;
    const k = (width - 2 * MARGIN) / Math.max(1, b.maxX - b.minX);
    const z = (v: number) => MARGIN + (v - b.minY) * k;
    return { k, width, height: z(b.maxY) + MARGIN, x: (v) => MARGIN + (v - b.minX) * k, z };
}

/** The shown nodes placed and every other slot anchored, with the frame, bands and band titles. */
interface PlacedNodes { layout: Layout2D; f: GraphFrame; d: Draft; a11y: Placement['a11y']; planes: PlaneSpec[]; titles: BandTitle[]; bounds: Bounds; captions: Caption[] }

function placeNodes(g: KnowledgeGraph, model: StageModel, req: PlacementReq, nodes: readonly KNode[], layout: Layout2D): PlacedNodes {
    const { marks } = model;
    const f = graphFrameOf(layout, req.viewportBand);
    const d = draftFor(marks.keys.length);
    const a11y: Placement['a11y'] = [];
    for (const [ref, [px, py]] of layout.positions) {
        const slot = model.nodeSlot.get(ref);
        if (slot === undefined) continue;
        // A node's slot is its index in the graph's nodes.
        show(d, slot, f.x(px), 0, f.z(py), nodeRadius(g.nodes[slot]?.importance ?? 0) * f.k);
        a11y.push({ slot, label: marks.label[slot] ?? ref });
    }
    // The reading order is the 2D graph's: importance first, ties by ref.
    a11y.sort((a, b) => byImportance(g.nodes[a.slot]!, g.nodes[b.slot]!));
    anchorAtCommunity(g, model, d, nodes);
    anchorHidden(marks, d, 'station', [f.width / 2, 0, f.height / 2]);
    const planes: PlaneSpec[] = layout.bands.map((band, i) => ({ kind: 'partition', min: [0, -0.5, f.z(band.top)], max: [f.width, -0.5, f.z(band.top + band.height)], tone: BAND_TONES[i % 2]! }));
    // A band is keyed by placement (a partition, `community:<id>`, or '' for none): its caption is that key's name.
    const words = placementWordsOf(model.strings);
    const titles: BandTitle[] = layout.bands.map((band) => ({ band: worldBand(f, band), text: placementLabel(band.partition, g, words) }));
    const bounds: Bounds = { minX: f.x(layout.bounds.minX), maxX: f.x(layout.bounds.maxX), minY: f.z(layout.bounds.minY), maxY: f.z(layout.bounds.maxY) };
    // Band titles first, as the 2D graph draws them; the names then treat their boxes as taken (`graphCaptions.ts`).
    const captions: Caption[] = titles.map((t) => bandTitleCaption(t, bounds));
    return { layout, f, d, a11y, planes, titles, bounds, captions };
}

/** A shown node's slot, else undefined. */
const shownSlot = (model: StageModel, d: Draft, ref: string): number | undefined => {
    const slot = model.nodeSlot.get(ref);
    return slot === undefined || d.placed[slot] !== VISIBLE ? undefined : slot;
};
const groundOf = (d: Draft, slot: number): readonly [number, number] => [d.position[slot * 3]!, d.position[slot * 3 + 2]!];

/** The 2D graph's drawn edges split for the band: a shown node's aggregate is its station's slot, else its own. */
function bundleFor(model: StageModel, p: PlacedNodes, ranked: RankedEdges, band: BundleBudget): BundledEdges {
    const aggregateOf = (ref: string): number | undefined => {
        const slot = shownSlot(model, p.d, ref);
        if (slot === undefined) return undefined;
        const station = model.marks.parentStation[slot]!;
        return station >= 0 ? station : slot;
    };
    return bundleEdges(pickEdges(ranked, null, MAX_DRAWN_EDGES), aggregateOf, band);
}

function captionRunsFor(model: StageModel, p: PlacedNodes, nodes: readonly KNode[]): LabelRun[] {
    const { d } = p;
    const named: GraphCaptionNode[] = [...nodes].sort(byImportance).slice(0, MAX_NAMES).flatMap((n) => {
        const slot = shownSlot(model, d, n.ref);
        if (slot === undefined) return [];
        return [{ slot, ref: n.ref, x: d.position[slot * 3]!, z: d.position[slot * 3 + 2]!, r: d.scale[slot]!, text: model.marks.label[slot] ?? n.label, importance: n.importance }];
    });
    return graphCaptionRuns(named, p.titles, p.bounds);
}

function assemble(model: StageModel, req: PlacementReq, p: PlacedNodes, bundled: BundledEdges, labels: LabelRun[], total: number): Placement {
    const { marks } = model;
    const { d, f, layout } = p;
    const nodeAt = (ref: string) => { const slot = shownSlot(model, d, ref); return slot === undefined ? undefined : groundOf(d, slot); };
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        links: [graphEdgeLinks(bundled, nodeAt, (slot) => groundOf(d, slot))], planes: p.planes, labels, captions: p.captions, a11y: p.a11y,
        caption: {
            shown: layout.positions.size, total: model.nodeSlot.size, capped: layout.positions.size < model.nodeSlot.size,
            edges: { shown: bundled.drawn, total, capped: bundled.drawn < total },
        },
        bounds: { min: [0, 0, 0], max: [f.width, 0, f.height] },
        rig: {
            projection: 'orthographic', frame: 'fill',
            home: { position: [f.width / 2, 1000, f.height / 2], target: [f.width / 2, 0, f.height / 2], up: [0, 0, -1] },
            depth: { tilt: [0, 60], orbit: false },
        },
    };
}

const worldBand = (f: GraphFrame, band: Band): Band => ({ partition: band.partition, top: f.z(band.top), height: band.height * f.k });

/**
 * Hidden nodes with no station sit at their community / partition band: the centroid of that band's shown nodes (the
 * band key is the layout's own, `planeKeyOf` among the shown nodes). Nodes with a station are left to `anchorHidden`.
 */
function anchorAtCommunity(g: KnowledgeGraph, model: StageModel, d: Draft, shown: readonly KNode[]): void {
    const { marks } = model;
    const sum = new Map<string, [number, number, number, number]>();
    for (const n of shown) {
        const slot = model.nodeSlot.get(n.ref);
        if (slot === undefined || d.placed[slot] !== VISIBLE) continue;
        const key = planeKeyOf(n, shown) ?? NONE_PARTITION;
        const s = sum.get(key) ?? sum.set(key, [0, 0, 0, 0]).get(key)!;
        s[0] += d.position[slot * 3]!; s[1] += d.position[slot * 3 + 1]!; s[2] += d.position[slot * 3 + 2]!; s[3]++;
    }
    g.nodes.forEach((n, slot) => {
        if (d.placed[slot] !== 0 || marks.parentStation[slot]! >= 0) return;
        const s = sum.get(planeKeyOf(n, shown) ?? NONE_PARTITION);
        if (s) hide(d, slot, s[0] / s[3], s[1] / s[3], s[2] / s[3]);
    });
}
