/**
 * The Map placement (Transit + Tower, PRD 43 B1a rule 7) from the EXISTING `layoutTransit` output — the layout is not
 * rewritten here, only read: each drawn station is shown at its transit position on the map plane (world x = map x,
 * world z = map y), every node is anchored at its station at scale 0, the routes become one `route` link batch with the
 * background casing, and the layer bands become planes. The overlay's geometry channels are data (`req.channels`) read
 * through the ONE `makeOverlay`, exactly as the SVG map reads them: a station's radius is its size channel
 * (`StationStyle.size`), a route's width its line's width channel (`lineWidth` over the line's stops). Tilt is extrude:
 * `depth` 0 is the flat map, 1 raises every station into its tower, height = the size channel (`towerHeight`, the
 * SVG tower's own reading). Pure.
 */

import { makeOverlay, segmentUntested } from '../../../surface/overlays';
import { towerHeight } from '../../../surface/transit/towerHeight';
import { layoutTransit } from '../../../surface/transitLayout';
import { RESTING_DEPTH } from '../../../stage/depth';
import { FORM_RISE, TYPE_FORM } from '../../../stage/marks/forms';
import { MARK_TYPE_ORDER } from '../../../shapes';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DASH_CYCLE, DASH_SOLID, DASH_UNTESTED, FLAG, type Caption, type LabelRun, type Placement, type PlaneSpec } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { linkBatch, type LinkPath } from './links';
import { mapDecorations } from './mapDecor';
import { widenMapBounds } from './mapBounds';
import { roofMinis } from './roofMinis';
import { channelBindings, placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

const CASING_EXTRA = 4;
const TEXT = toneIndex('text');
/** The design's home view: fov 38, theta -0.55 rad (yaw), phi 0.95 rad (pitch = 90° - phi), heights collapse to 0.03 in Flat. */
const HOME_FOV = 38, HOME_YAW = (-0.55 * 180) / Math.PI, HOME_PITCH = 90 - (0.95 * 180) / Math.PI, FLAT_DEPTH = 0.03;
/** The floor plate's thickness, as a share of the level's width. */
const PLATE_THICKNESS = 0.02;

/** `g`: the graph the stations were folded from — the describes links and HTTP walls read it (`mapDecor.ts`); absent = none. */
export function placeMap(model: StageModel, req: PlacementReq, g?: Pick<KnowledgeGraph, 'nodes' | 'edges'>): Placement {
    const { stations, lines, marks } = model;
    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const layout = layoutTransit(stations.stations, lines.lines, width, model.order ? { order: model.order } : {});
    const depth = Math.max(0, Math.min(1, req.depth ?? RESTING_DEPTH));
    const d = draftFor(marks.keys.length);
    const labels: LabelRun[] = [];
    const a11y: Placement['a11y'] = [];
    let top = 0;
    const overlay = makeOverlay(channelBindings(req.channels), stations.stations);

    for (const id of layout.drawn) {
        const slot = model.stationSlot.get(id), at = layout.positions.get(id), s = stations.byId.get(id);
        if (slot === undefined || !at || !s) continue;
        const size = overlay.style(s).size;
        const form = TYPE_FORM[MARK_TYPE_ORDER[marks.type[slot]!] ?? 'source'];
        const extrude = depth * towerHeight(size, s.cx) * FORM_RISE[form];
        top = Math.max(top, extrude);
        show(d, slot, at.x, 0, at.y, size, extrude);
        labels.push({
            slot, text: s.name, offsetPx: [0, size + 12], font: 'mono', size: 11, weight: 500, anchor: 'middle',
            tone: TEXT, halo: { tone: BG_TONE, px: 3 }, priority: s.use, scale: 'world',
            chip: { risky: s.anti >= 3 },
        });
        a11y.push({ slot, label: s.path ?? s.name });
    }
    roofMinis(model, d, layout.drawn);
    anchorHidden(marks, d, 'station', [layout.width / 2, 0, layout.height / 2]);

    const lineIndex = new Map(lines.lines.map((l) => [l.id, l] as const));
    const widths = new Map(lines.lines.map((l) => [l.id, overlay.lineWidth(l.stops.flatMap((id) => stations.byId.get(id) ?? []))] as const));
    const neutralWidth = overlay.lineWidth([]);
    const paths: LinkPath[] = layout.routes.map((r) => {
        const from = stations.byId.get(r.from), to = stations.byId.get(r.to);
        const untested = !!from && !!to && segmentUntested(from, to) === true;
        const line = lineIndex.get(r.lineId);
        // Never colour alone: an untested hop dashes 9/7 in the violation tone, a cycle hop dashes 3/5 (the SVG's HopPath).
        const cycle = line?.hops[r.index]?.cycle === true;
        return {
            pts: r.pts, width: widths.get(r.lineId) ?? neutralWidth, flags: FLAG.SELECTABLE,
            tone: untested ? toneIndex('violation') : cycle ? toneIndex('cycle') : toneIndex('hall'),
            dash: untested ? DASH_UNTESTED : cycle ? DASH_CYCLE : DASH_SOLID,
        };
    });

    // ONE floor plate per level (the layer bands belong to the Layers camera): the floor at the top level, the room inside a shape.
    const thick = Math.max(4, layout.width * PLATE_THICKNESS), inside = req.drill != null;
    const planes: PlaneSpec[] = [{ kind: 'room', min: [0, -thick, 0], max: [layout.width, 0, layout.height], tone: toneIndex(inside ? 'room' : 'floor'), edge: toneIndex(inside ? 'lit' : 'edge') }];
    // The perspective Map has no band captions (the design has none, and a ground caption drifts under a tilted camera); the
    // Layers camera keeps its band titles (`rows.ts`).
    const captions: Caption[] = [];
    const cx = layout.width / 2, cz = layout.height / 2;
    const decor = g ? mapDecorations(g, stations, layout) : [];
    const bounds = widenMapBounds(layout, widths, neutralWidth, CASING_EXTRA, top, decor);
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        // Each route polyline (`group`) names its line, so a route pick selects the line (as the SVG map's hop does).
        links: [{ ...linkBatch('hall', paths, 0), lineIds: layout.routes.map((r) => r.lineId) }, ...decor],
        planes, labels, captions, a11y,
        caption: { shown: layout.drawn.length, total: stations.stations.length, capped: layout.drawn.length < stations.stations.length },
        bounds,
        rig: {
            projection: 'perspective', frame: 'fill',
            home: { position: [cx, 1000, cz], target: [cx, top * 0.35, cz], up: [0, 1, 0] },
            depth: { tilt: [5, 83], orbit: true },
            // Fit-to-content: the rig derives the distance from the stage's own aspect (and again on every resize).
            view: { yaw: HOME_YAW, pitch: HOME_PITCH, distance: 1000, fov: HOME_FOV, radius: Math.hypot(layout.width, layout.height, top) / 2 + 12, flatDepth: FLAT_DEPTH },
        },
    };
}
