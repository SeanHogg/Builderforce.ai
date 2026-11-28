/**
 * The transit Map placement (Transit + Tower, PRD 43 B1a rule 7) from the EXISTING `layoutTransit` output — the layout is not
 * rewritten here, only read: each drawn station is shown at its transit position on the map plane (world x = map x,
 * world z = map y), every node is anchored at its station at scale 0, the routes become one `route` link batch with the
 * background casing, and the layer bands become planes. The overlay's geometry channels are data (`req.channels`) read
 * through the ONE `makeOverlay`, exactly as the SVG map reads them: a station's radius is its size channel
 * (`StationStyle.size`), a route's width its line's width channel (`lineWidth` over the line's stops). Tilt is extrude:
 * `depth` 0 is the flat map, 1 raises every station into its tower, height = the size channel (`towerHeight`, the
 * SVG tower's own reading). The Map and 3D CAMERAS draw one level at a time through `level.ts`; this transit layout is what
 * the other cameras' drilled levels (`drill.ts`) are placed with. Pure.
 */

import { makeOverlay, segmentUntested } from '../../../surface/overlays';
import { towerHeight } from '../../../surface/transit/towerHeight';
import { layoutFloors } from './mapFloors';
import { systemName } from '../../../surface/systems';
import { CAMERA_WORD, wordIn } from './cameraStrings';
import { RESTING_DEPTH } from '../../../stage/depth';
import { FORM_RISE, TYPE_FORM } from '../../../stage/marks/forms';
import { MARK_TYPE_ORDER } from '../../../shapes';
import { toneIndex } from '../../../stage/tones';
import type { KnowledgeGraph } from '@seanhogg/builderforce-memory/knowledge';
import { DASH_CYCLE, DASH_SOLID, DASH_UNTESTED, FLAG, type Caption, type LabelRun, type Placement, type PlaneSpec } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { chipLabel } from './chipLabel';
import { linkBatch, type LinkPath } from './links';
import { mapDecorations } from './mapDecor';
import { widenMapBounds } from './mapBounds';
import { contentPoints, homeRig, mapFit } from './mapFit';
import { channelBindings, placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

const CASING_EXTRA = 4;
const TEXT = toneIndex('text');
/** The floor plate's thickness, as a share of the level's width. */
const PLATE_THICKNESS = 0.02;

/** `g`: the graph the stations were folded from — the describes links and HTTP walls read it (`mapDecor.ts`); absent = none. */
export function placeMap(model: StageModel, req: PlacementReq, g?: Pick<KnowledgeGraph, 'nodes' | 'edges'>): Placement {
    const { stations, lines, marks } = model;
    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const hidden = new Set(req.hiddenStations);
    const visible = stations.stations.filter((station) => !hidden.has(station.id));
    const { layout, floors } = layoutFloors(visible, lines.lines, width, model.order);
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
        labels.push(chipLabel(slot, marks.label[slot] ?? s.name, size, s.use, s.anti >= 3, marks.tooltip[slot]));
        a11y.push({ slot, label: marks.tooltip[slot] ?? s.path ?? s.name });
    }
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

    const thick = Math.max(4, layout.width * PLATE_THICKNESS), inside = req.drill != null;
    const planes: PlaneSpec[] = visible.length ? floors.map((floor) => ({
        kind: 'room', min: [0, -thick, floor.offset], max: [floor.width, 0, floor.offset + floor.depth],
        tone: toneIndex(inside ? 'room' : 'floor'), edge: toneIndex(inside ? 'lit' : 'edge'),
    })) : [];
    const captions: Caption[] = !inside && (floors.length > 1 || (lines.systems?.length ?? 0) > 1) && visible.length
        ? floors.map((floor) => ({
            role: 'plane', anchor: 'start', tone: TEXT, position: [20, 0, floor.offset + 16],
            text: systemName(lines.systems, floor.system) || wordIn(model.strings, CAMERA_WORD.systemLoose),
        })) : [];
    const fit = mapFit(layout, contentPoints(layout.positions, layout.drawn, layout.routes), top);
    const decor = g ? mapDecorations(g, stations, layout) : [];
    const bounds = widenMapBounds(layout, widths, neutralWidth, CASING_EXTRA, top, decor);
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        // Each route polyline (`group`) names its line, so a route pick selects the line (as the SVG map's hop does).
        links: [{ ...linkBatch('hall', paths, 0), lineIds: layout.routes.map((r) => r.lineId) }, ...decor],
        planes, labels, captions, a11y,
        caption: { shown: layout.drawn.length, total: visible.length, capped: layout.drawn.length < visible.length },
        bounds,
        rig: homeRig(fit, top),
    };
}
