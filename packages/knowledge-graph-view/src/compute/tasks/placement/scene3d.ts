/**
 * The 3D placement (PRD 43 B2, the 3D row; P4) from the EXISTING `layout3d` output — the layout is not rewritten, only
 * read, so the stage's 3D camera stands every node exactly where the R3F scene (`scene/GraphScene.tsx`) stands it:
 *
 *   - the focused nodes (the same `focusGraph` cut every node camera draws) at their layout positions, scaled into the
 *     viewport band's width — x and z on the ground, y the node's PLANE (its partition / community tier, flow-ordered by
 *     `planeOrder`), so the planes stack in depth;
 *   - each node's scale is the scene's own reading (`nodeScale`, the tower radius = 0.8 × it), its extrude the tower
 *     height from the size channel (`scene/channels.ts` `nodeChannels` over `towerHeight`), so every mark is its type
 *     silhouette extruded into the scene's tower;
 *   - the drawn edges (the ONE ranking, `pickEdges` for no selection, capped at the `edge` family's capacity so a switch
 *     never overflows into a rebuild) as one `edge` link batch of straight 3D segments, toned by `edgeBucket`;
 *   - one `partition` plane per tier, captioned by `placementLabel` (localized from the markSet's `strings`);
 *   - every other slot hidden at its anchor (scale 0, `anchorHidden`), so Map → 3D grows the members out of their station.
 *
 * Selection stays out (rule 6): no incident edges here, the overlay adds them. The rig is a free-orbit perspective one,
 * with the scene's home pose (`rig.view`). A stepping task: the layout and the edge ranking yield between slices. Pure.
 */

import type { KEdge, KNode, KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { focusGraph } from '../../../graphModel';
import { importanceOf } from '../../../order';
import { placementLabel } from '../../../placement';
import type { IdleTask } from '../../../useIdleSteps';
import { edgeBucket, nodeScale } from '../../../scene/buffers';
import { nodeChannels } from '../../../scene/channels';
import { edgeCaption, MAX_DRAWN_EDGES, pickEdges, rankTask, type RankedEdges } from '../../../scene/edgeBudget';
import { layoutTask, type Layout3D } from '../../../scene/layout3d';
import { makeOverlay } from '../../../surface/overlays';
import { LINK_FAMILY_STYLE } from '../../../stage/links/families';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import { DASH_SOLID, type Caption, type CameraRig, type LabelRun, type LinkBatch, type Placement, type PlaneSpec, type Vec3 } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { GRAPH_SHOWN_BY_LOD, placementWordsOf } from './graph';
import { polylineBatch, type WorldPath } from './links';
import { channelBindings, placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

const MARGIN = 24;
/** The scene's tower radius is 0.8 × the node's scale (`towerBodies`). */
const TOWER_RADIUS = 0.8;
/** A plane sits this far (layout units) under its tier's nodes, as the scene draws it. */
const PLANE_DROP = 0.6;
/** Mono names drawn for the most important shown nodes (the rest are in the a11y list and the hover tooltip). */
const LABELS_SHOWN = 40;
/** The edges drawn: the scene's budget, never past what the `edge` family's mesh holds (an overflow is a rebuild). */
export const SCENE3D_EDGE_CAP = Math.min(MAX_DRAWN_EDGES, LINK_FAMILY_STYLE.edge.capacity);
/** The scene's home pose: the camera at (span, 0.7·span, span) from the centre, fov 50. */
const HOME_YAW = 45;
const HOME_PITCH = (Math.atan2(0.7, Math.SQRT2) * 180) / Math.PI;
const HOME_DISTANCE = Math.sqrt(2.49);
const HOME_FOV = 50;
const PLANE_TONES = [toneIndex('plane'), toneIndex('bg')];
const TEXT = toneIndex('text');

export function placeScene3d(g: KnowledgeGraph, model: StageModel, req: PlacementReq): IdleTask<Placement> {
    const max = GRAPH_SHOWN_BY_LOD[Math.min(req.lod, GRAPH_SHOWN_BY_LOD.length - 1)]!;
    const shown = focusGraph(g, max, []);
    const layout = layoutTask(g.scope.rootId, shown.nodes, shown.edges);
    let rank: IdleTask<RankedEdges> | null = null;
    let built: Placement | null = null;
    return {
        step: () => {
            if (!layout.step()) return false;
            rank ??= rankTask(shown.edges, shown.nodes);
            return rank.step();
        },
        result: () => (built ??= fromLayout(g, model, req, shown.nodes, layout.result(), rank!.result())),
    };
}

/** World frame of a layout: x/z fitted into the band's width from MARGIN, y (the tier) on the same scale. */
export interface Frame3D { k: number; minX: number; minZ: number; width: number; depth: number }

export function frameOf(layout: Layout3D, width: number): Frame3D {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, , z] of layout.positions.values()) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 0; minZ = 0; maxZ = 0; }
    const k = (width - 2 * MARGIN) / Math.max(1, maxX - minX, maxZ - minZ);
    return { k, minX, minZ, width: (maxX - minX) * k + 2 * MARGIN, depth: (maxZ - minZ) * k + 2 * MARGIN };
}

/** A layout point → world. */
export const worldOf = (f: Frame3D, [x, y, z]: readonly [number, number, number]): [number, number, number] =>
    [MARGIN + (x - f.minX) * f.k, y * f.k, MARGIN + (z - f.minZ) * f.k];

function fromLayout(g: KnowledgeGraph, model: StageModel, req: PlacementReq, nodes: readonly KNode[], layout: Layout3D, ranked: RankedEdges): Placement {
    const { marks } = model;
    const f = frameOf(layout, VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!);
    const towers = nodeChannels(nodes, model.stations, makeOverlay(channelBindings(req.channels), model.stations.stations));
    const d = draftFor(marks.keys.length);
    const at = new Map<string, [number, number, number]>();
    const a11y: Placement['a11y'] = [];
    let top = 0;
    for (const n of nodes) {
        const slot = model.nodeSlot.get(n.ref), p = layout.positions.get(n.ref);
        if (slot === undefined || !p) continue;
        const w = worldOf(f, p);
        const extrude = (towers.get(n.ref)?.height ?? 0) * f.k;
        top = Math.max(top, w[1] + extrude);
        show(d, slot, w[0], w[1], w[2], nodeScale(n) * TOWER_RADIUS * f.k, extrude);
        at.set(n.ref, w);
        a11y.push({ slot, label: marks.label[slot] ?? n.ref });
    }
    const centre: Vec3 = [f.width / 2, 0, f.depth / 2];
    anchorHidden(marks, d, 'station', centre);

    const words = placementWordsOf(model.strings);
    const planes: PlaneSpec[] = [], captions: Caption[] = [];
    layout.planes.forEach((plane, i) => {
        const y = (plane.y - PLANE_DROP) * f.k;
        planes.push({ kind: 'partition', min: [0, y, 0], max: [f.width, y, f.depth], tone: PLANE_TONES[i % 2]! });
        captions.push({ text: placementLabel(plane.partition, g, words), position: [MARGIN / 2, y, MARGIN / 2], anchor: 'start', tone: toneIndex('muted'), role: 'plane' });
    });

    const edges = pickEdges(ranked, null, SCENE3D_EDGE_CAP);
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        links: [edgeLinks(edges, at)], planes, labels: labelsOf(nodes, model, at), captions, a11y,
        caption: edgeCaption(ranked.total, SCENE3D_EDGE_CAP),
        bounds: { min: [0, Math.min(0, ...planes.map((p) => p.min[1])), 0], max: [f.width, top, f.depth] },
        rig: rigOf(f, top),
    };
}

/** Straight 3D segments, one polyline (and one `group`) per edge, toned as the scene buckets them — packed by the ONE `polylineBatch`. */
export function edgeLinks(edges: readonly KEdge[], at: ReadonlyMap<string, readonly [number, number, number]>): LinkBatch {
    const style = LINK_FAMILY_STYLE.edge;
    const paths: WorldPath[] = [];
    for (const e of edges) {
        const a = at.get(e.from), b = at.get(e.to);
        if (a && b) paths.push({ pts: [[a[0], a[1], a[2]], [b[0], b[1], b[2]]], tone: toneIndex(edgeBucket(e).tone), width: style.width, dash: DASH_SOLID, flags: 0 });
    }
    return polylineBatch('edge', paths, style.widthUnit);
}

/** Mono names for the most important shown nodes (data names, never catalog words), placed in screen space. */
function labelsOf(nodes: readonly KNode[], model: StageModel, at: ReadonlyMap<string, unknown>): LabelRun[] {
    return nodes
        .filter((n) => at.has(n.ref))
        .map((n) => ({ n, slot: model.nodeSlot.get(n.ref)!, importance: importanceOf(n) }))
        .sort((a, b) => b.importance - a.importance || (a.n.ref < b.n.ref ? -1 : a.n.ref > b.n.ref ? 1 : 0))
        .slice(0, LABELS_SHOWN)
        .map(({ n, slot, importance }) => ({
            slot, text: model.marks.label[slot] ?? n.ref, offsetPx: [0, -14], font: 'mono', size: 10, weight: 400, anchor: 'middle',
            tone: TEXT, halo: { tone: BG_TONE, px: 3 }, priority: importance, scale: 'screen',
        }));
}

/** The scene's home: look at the centre from yaw 45°, pitch ≈ 26°, at its distance for the layout's span. */
function rigOf(f: Frame3D, top: number): CameraRig {
    const span = Math.max(f.width, f.depth);
    const target: Vec3 = [f.width / 2, top / 2, f.depth / 2];
    const distance = span * HOME_DISTANCE;
    const yaw = (HOME_YAW * Math.PI) / 180, pitch = (HOME_PITCH * Math.PI) / 180;
    const position: Vec3 = [
        target[0] + distance * Math.cos(pitch) * Math.sin(yaw),
        target[1] + distance * Math.sin(pitch),
        target[2] + distance * Math.cos(pitch) * Math.cos(yaw),
    ];
    return {
        projection: 'perspective', frame: 'fill',
        home: { position, target, up: [0, 1, 0] },
        depth: { tilt: [5, 89], orbit: true },
        view: { yaw: HOME_YAW, pitch: HOME_PITCH, distance, fov: HOME_FOV },
    };
}
