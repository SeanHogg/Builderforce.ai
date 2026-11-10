/**
 * The Graph placement from the EXISTING `layout2d` output (PRD 43 B1a rule 4) — the layout is not rewritten, only read:
 * the focused nodes (the same `focusGraph` cut the Graph camera draws) are shown at their 2D layout positions, scaled
 * into the viewport band's width (layout y → world z), sized by `nodeRadius`; every station is anchored at the centroid
 * of its shown members and every other node at its station, all at scale 0; the placement bands become planes, captioned
 * by `placementLabel`. The Graph camera has no channel-bound geometry: a node's radius is its importance (`nodeRadius`,
 * today's Graph), and it draws no links yet (P3).
 * A stepping task: the layout is the slow part and yields between relaxation passes. Pure.
 */

import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { layout2dTask, nodeRadius, type Layout2D } from '../../../graph2d/layout2d';
import { focusGraph } from '../../../graphModel';
import { placementLabel, type PlacementWords } from '../../../placement';
import type { IdleTask } from '../../../useIdleSteps';
import { toneIndex } from '../../../stage/tones';
import type { Caption, Placement, PlaneSpec } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

/**
 * Nodes the Graph camera shows per LOD band: band 0 is today's cap (`KnowledgeGraphView`'s MAX_DRAWN_NODES); a higher
 * band shows every node (B4 bundling and LOD refine this in P3).
 */
export const GRAPH_SHOWN_BY_LOD: readonly number[] = [2000, Number.POSITIVE_INFINITY];
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

export function placeGraph(g: KnowledgeGraph, model: StageModel, req: PlacementReq): IdleTask<Placement> {
    const max = GRAPH_SHOWN_BY_LOD[Math.min(req.lod, GRAPH_SHOWN_BY_LOD.length - 1)]!;
    const shown = focusGraph(g, max, []);
    const task = layout2dTask(g.scope.rootId, shown.nodes, shown.edges);
    let built: Placement | null = null;
    return {
        step: () => task.step(),
        result: () => (built ??= fromLayout(g, model, req, task.result())),
    };
}

function fromLayout(g: KnowledgeGraph, model: StageModel, req: PlacementReq, layout: Layout2D): Placement {
    const { marks } = model;
    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const b = layout.bounds;
    const k = (width - 2 * MARGIN) / Math.max(1, b.maxX - b.minX);
    const x = (v: number) => MARGIN + (v - b.minX) * k, z = (v: number) => MARGIN + (v - b.minY) * k;
    const d = draftFor(marks.keys.length);
    const a11y: Placement['a11y'] = [];
    for (const [ref, [px, py]] of layout.positions) {
        const slot = model.nodeSlot.get(ref);
        if (slot === undefined) continue;
        // A node's slot is its index in the graph's nodes.
        show(d, slot, x(px), 0, z(py), nodeRadius(g.nodes[slot]?.importance ?? 0) * k);
        a11y.push({ slot, label: marks.label[slot] ?? ref });
    }
    const height = z(b.maxY) + MARGIN;
    anchorHidden(marks, d, 'station', [width / 2, 0, height / 2]);
    const planes: PlaneSpec[] = layout.bands.map((band, i) => ({ kind: 'partition', min: [0, -0.5, z(band.top)], max: [width, -0.5, z(band.top + band.height)], tone: BAND_TONES[i % 2]! }));
    // A band is keyed by placement (a partition, `community:<id>`, or '' for none): its caption is that key's name.
    const words = placementWordsOf(model.strings);
    const captions: Caption[] = layout.bands.map((band) => ({ text: placementLabel(band.partition, g, words), position: [MARGIN, 0, z(band.top) + 12], anchor: 'start', tone: toneIndex('muted') }));
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        links: [], planes, labels: [], captions, a11y,
        caption: { shown: layout.positions.size, total: model.nodeSlot.size, capped: layout.positions.size < model.nodeSlot.size },
        bounds: { min: [0, 0, 0], max: [width, 0, height] },
        rig: {
            projection: 'orthographic', frame: 'fill',
            home: { position: [width / 2, 1000, height / 2], target: [width / 2, 0, height / 2], up: [0, 0, -1] },
            depth: { tilt: [0, 60], orbit: false },
        },
    };
}
