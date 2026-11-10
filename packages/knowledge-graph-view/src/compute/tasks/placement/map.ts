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

import { bandTitleIn } from '../../../surface/bands';
import { lineTone, makeOverlay, segmentUntested } from '../../../surface/overlays';
import { towerHeight } from '../../../surface/transit/towerHeight';
import { layoutTransit } from '../../../surface/transitLayout';
import { BG_TONE, toneIndex } from '../../../stage/tones';
import { DASH_SOLID, DASH_UNTESTED, FLAG, type Caption, type LabelRun, type Placement, type PlaneSpec } from '../../../stage/types';
import type { StageModel } from '../stageModel';
import { anchorHidden, draftFor, show } from './anchor';
import { linkBatch, type LinkPath } from './links';
import { channelBindings, placementKeyOf, VIEWPORT_BANDS, type PlacementReq } from './request';

const CASING_EXTRA = 4;
const TEXT = toneIndex('text');
const BAND_TONES = [toneIndex('panel'), toneIndex('bg')];

export function placeMap(model: StageModel, req: PlacementReq): Placement {
    const { stations, lines, marks } = model;
    const width = VIEWPORT_BANDS[req.viewportBand] ?? VIEWPORT_BANDS[2]!;
    const layout = layoutTransit(stations.stations, lines.lines, width, model.order ? { order: model.order } : {});
    const depth = Math.max(0, Math.min(1, req.depth ?? 0));
    const d = draftFor(marks.keys.length);
    const labels: LabelRun[] = [];
    const a11y: Placement['a11y'] = [];
    let top = 0;
    const overlay = makeOverlay(channelBindings(req.channels), stations.stations);

    for (const id of layout.drawn) {
        const slot = model.stationSlot.get(id), at = layout.positions.get(id), s = stations.byId.get(id);
        if (slot === undefined || !at || !s) continue;
        const size = overlay.style(s).size;
        const extrude = depth * towerHeight(size, s.cx);
        top = Math.max(top, extrude);
        show(d, slot, at.x, 0, at.y, size, extrude);
        labels.push({
            slot, text: s.name, offsetPx: [0, size + 12], font: 'mono', size: 11, weight: 500, anchor: 'middle',
            tone: TEXT, halo: { tone: BG_TONE, px: 3 }, priority: s.use, scale: 'world',
        });
        a11y.push({ slot, label: s.path ?? s.name });
    }
    anchorHidden(marks, d, 'station', [layout.width / 2, 0, layout.height / 2]);

    const lineIndex = new Map(lines.lines.map((l) => [l.id, l] as const));
    const widths = new Map(lines.lines.map((l) => [l.id, overlay.lineWidth(l.stops.flatMap((id) => stations.byId.get(id) ?? []))] as const));
    const neutralWidth = overlay.lineWidth([]);
    const paths: LinkPath[] = layout.routes.map((r) => {
        const from = stations.byId.get(r.from), to = stations.byId.get(r.to);
        const untested = !!from && !!to && segmentUntested(from, to) === true;
        const line = lineIndex.get(r.lineId);
        return {
            pts: r.pts, width: widths.get(r.lineId) ?? neutralWidth, flags: FLAG.SELECTABLE,
            tone: untested ? toneIndex('violation') : toneIndex(lineTone(line?.colourIndex ?? r.index)),
            dash: untested ? DASH_UNTESTED : DASH_SOLID,
        };
    });

    const planes: PlaneSpec[] = layout.bands.map((b, i) => ({ kind: 'band', min: [0, -0.5, b.y], max: [layout.width, -0.5, b.y + b.h], tone: BAND_TONES[i % 2]! }));
    const captions: Caption[] = layout.bands.map((b) => ({ text: bandTitleIn(model.strings, b.layer), position: [8, 0, b.y + 14], anchor: 'start', tone: toneIndex('muted') }));
    const cx = layout.width / 2, cz = layout.height / 2;
    return {
        generation: marks.generation, cacheKey: placementKeyOf(marks, req), anchor: 'station',
        position: d.position, scale: d.scale, extrude: d.extrude,
        // Each route polyline (`group`) names its line, so a route pick selects the line (as the SVG map's hop does).
        links: [{ ...linkBatch('route', paths, 0, { tone: BG_TONE, extra: CASING_EXTRA }), lineIds: layout.routes.map((r) => r.lineId) }],
        planes, labels, captions, a11y,
        caption: { shown: layout.drawn.length, total: stations.stations.length, capped: layout.drawn.length < stations.stations.length },
        bounds: { min: [0, 0, 0], max: [layout.width, top, layout.height] },
        rig: {
            projection: 'orthographic', frame: 'document',
            home: { position: [cx, 1000, cz], target: [cx, 0, cz], up: [0, 0, -1] },
            depth: { tilt: [0, 60], orbit: false },
        },
    };
}
