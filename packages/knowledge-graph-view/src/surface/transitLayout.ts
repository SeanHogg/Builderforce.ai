/**
 * The transit map's geometry (PRD 38, Option B+): layer bands top to bottom, the stations of
 * each band spread evenly, and each hop of a line routed through the corridors between bands
 * (`transit/corridors`). A drilled level brings its own bands (`LayoutOptions.order`).
 * Pure and deterministic, so the map is the same on every host and a test can pin it.
 */

import { cmp, round } from '../order';
import { LAYER_ORDER } from './layers';
import type { Line } from './lines';
import type { Station } from './stations';
import { routeLines, type HopRoute } from './transit/corridors';
import type { Point } from './transit/geometry';

export { roundedPath, type Point } from './transit/geometry';
export type { HopRoute } from './transit/corridors';

export const BAND_HEIGHT = 120;
export const BAND_TOP = 12;
export const MAX_DRAWN_STATIONS = 36;
/** The most stations on lines that are drawn; lines are short (a handful of stops each), so this only bounds a degenerate input. */
export const MAX_ON_LINE_STATIONS = 120;
const MARGIN_X = 56;
/** Horizontal room one station and its label need. */
export const LABEL_SLOT = 96;
/** Stations not on any line sort after those that are. */
const OFF_LINE = 99;

export const OTHER_LAYER = 'other';

export interface Band { layer: string; y: number; h: number }

export interface TransitLayout {
    width: number;
    height: number;
    bands: Band[];
    positions: Map<string, Point>;
    /** The ids of the stations drawn (the rest are folded into the count). */
    drawn: string[];
    routes: HopRoute[];
    /** Station id → index of its band. */
    bandIndex: Map<string, number>;
    /** Stations on lines that were left off by {@link MAX_ON_LINE_STATIONS}: the map says "+N more stops". */
    hiddenOnLine: number;
}

export interface LayoutOptions {
    /** The bands, top to bottom (default: the five architecture layers). A station of another layer sits in `other`. */
    order?: readonly string[];
}

export function layoutTransit(stations: readonly Station[], lines: readonly Line[], width: number, opts: LayoutOptions = {}): TransitLayout {
    const order = opts.order ?? LAYER_ORDER;
    const bandOf = (s: Station): string => (s.layer && order.includes(s.layer) ? s.layer : OTHER_LAYER);
    const lineIndex = new Map<string, number>();
    lines.forEach((l, i) => l.stops.forEach((id) => { if (!lineIndex.has(id)) lineIndex.set(id, i); }));

    // Every station on a line (the first MAX_ON_LINE_STATIONS, in line order), then the most used of the rest, up to the cap.
    const onLineAll = stations.filter((s) => lineIndex.has(s.id)).sort((a, b) => lineIndex.get(a.id)! - lineIndex.get(b.id)!);
    const onLine = onLineAll.slice(0, MAX_ON_LINE_STATIONS);
    const rest = stations.filter((s) => !lineIndex.has(s.id)).sort((a, b) => b.use - a.use || cmp(a.id, b.id));
    const drawnStations = [...onLine, ...rest.slice(0, Math.max(0, MAX_DRAWN_STATIONS - onLine.length))];

    const byBand = new Map<string, Station[]>();
    for (const s of drawnStations) (byBand.get(bandOf(s)) ?? byBand.set(bandOf(s), []).get(bandOf(s))!).push(s);
    // Wide enough that the fullest band keeps its labels apart; the host scrolls the SVG sideways below that.
    const rowMax = Math.max(1, ...[...byBand.values()].map((row) => row.length));
    const w = Math.max(360, Math.round(width), MARGIN_X * 2 + rowMax * LABEL_SLOT);
    const layers = [...order, OTHER_LAYER].filter((l) => byBand.has(l));

    const bands: Band[] = layers.map((layer, i) => ({ layer, y: BAND_TOP + i * BAND_HEIGHT, h: BAND_HEIGHT }));
    const positions = new Map<string, Point>();
    const bandIndex = new Map<string, number>();
    const inner = w - MARGIN_X * 2;
    bands.forEach((band, bi) => {
        const row = byBand.get(band.layer)!.sort((a, b) =>
            (lineIndex.get(a.id) ?? OFF_LINE) - (lineIndex.get(b.id) ?? OFF_LINE) || cmp(a.name, b.name) || cmp(a.id, b.id));
        row.forEach((s, i) => {
            positions.set(s.id, { x: round(MARGIN_X + ((i + 0.5) * inner) / row.length), y: round(band.y + band.h / 2) });
            bandIndex.set(s.id, bi);
        });
    });

    const routes = routeLines({ lines, positions, bands, bandIndex });

    return {
        width: w, height: BAND_TOP + Math.max(1, bands.length) * BAND_HEIGHT, bands, positions,
        drawn: drawnStations.map((s) => s.id), routes, bandIndex, hiddenOnLine: onLineAll.length - onLine.length,
    };
}
