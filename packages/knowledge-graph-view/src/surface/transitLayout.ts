/**
 * The transit map's geometry (PRD 38, Option B+): layer bands top to bottom, the stations of
 * each band spread evenly, and each hop of a line routed orthogonally with rounded corners.
 * Pure and deterministic, so the map is the same on every host and a test can pin it.
 */

import { cmp, round } from '../order';
import { LAYER_ORDER } from './layers';
import type { Line } from './lines';
import type { Station } from './stations';

export const BAND_HEIGHT = 120;
export const BAND_TOP = 12;
export const MAX_DRAWN_STATIONS = 36;
const MARGIN_X = 56;
/** Horizontal room one station and its label need. */
export const LABEL_SLOT = 96;
/** Stations not on any line sort after those that are. */
const OFF_LINE = 99;

export const OTHER_LAYER = 'other';

export interface Band { layer: string; y: number; h: number }
export interface Point { x: number; y: number }

export interface HopRoute {
    lineId: string;
    index: number;
    from: string;
    to: string;
    d: string;
}

export interface TransitLayout {
    width: number;
    height: number;
    bands: Band[];
    positions: Map<string, Point>;
    /** The ids of the stations drawn (the rest are folded into the count). */
    drawn: string[];
    routes: HopRoute[];
}

/** A polyline as an SVG path with rounded corners of radius `r`. */
export function roundedPath(pts: readonly Point[], r: number): string {
    if (pts.length === 0) return '';
    let d = `M ${round(pts[0]!.x)} ${round(pts[0]!.y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
        const p0 = pts[i - 1]!, p1 = pts[i]!, p2 = pts[i + 1]!;
        const d1 = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1, d2 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
        const k = Math.min(r, d1 / 2, d2 / 2);
        d += ` L ${round(p1.x - ((p1.x - p0.x) / d1) * k)} ${round(p1.y - ((p1.y - p0.y) / d1) * k)}`;
        d += ` Q ${round(p1.x)} ${round(p1.y)} ${round(p1.x + ((p2.x - p1.x) / d2) * k)} ${round(p1.y + ((p2.y - p1.y) / d2) * k)}`;
    }
    const last = pts[pts.length - 1]!;
    return pts.length === 1 ? d : `${d} L ${round(last.x)} ${round(last.y)}`;
}

const bandOf = (s: Station): string => (s.layer && (LAYER_ORDER as readonly string[]).includes(s.layer) ? s.layer : OTHER_LAYER);

export function layoutTransit(stations: readonly Station[], lines: readonly Line[], width: number): TransitLayout {
    const lineIndex = new Map<string, number>();
    lines.forEach((l, i) => l.stops.forEach((id) => { if (!lineIndex.has(id)) lineIndex.set(id, i); }));

    // Every station on a line, then the most used of the rest, up to the cap.
    const onLine = stations.filter((s) => lineIndex.has(s.id));
    const rest = stations.filter((s) => !lineIndex.has(s.id)).sort((a, b) => b.use - a.use || cmp(a.id, b.id));
    const drawnStations = [...onLine, ...rest.slice(0, Math.max(0, MAX_DRAWN_STATIONS - onLine.length))];

    const byBand = new Map<string, Station[]>();
    for (const s of drawnStations) (byBand.get(bandOf(s)) ?? byBand.set(bandOf(s), []).get(bandOf(s))!).push(s);
    // Wide enough that the fullest band keeps its labels apart; the host scrolls the SVG sideways below that.
    const rowMax = Math.max(1, ...[...byBand.values()].map((row) => row.length));
    const w = Math.max(360, Math.round(width), MARGIN_X * 2 + rowMax * LABEL_SLOT);
    const layers = [...LAYER_ORDER, OTHER_LAYER].filter((l) => byBand.has(l));

    const bands: Band[] = layers.map((layer, i) => ({ layer, y: BAND_TOP + i * BAND_HEIGHT, h: BAND_HEIGHT }));
    const positions = new Map<string, Point>();
    const inner = w - MARGIN_X * 2;
    for (const band of bands) {
        const row = byBand.get(band.layer)!.sort((a, b) =>
            (lineIndex.get(a.id) ?? OFF_LINE) - (lineIndex.get(b.id) ?? OFF_LINE) || cmp(a.name, b.name) || cmp(a.id, b.id));
        row.forEach((s, i) => positions.set(s.id, { x: round(MARGIN_X + ((i + 0.5) * inner) / row.length), y: round(band.y + band.h / 2) }));
    }

    const routes: HopRoute[] = [];
    lines.forEach((line, li) => {
        line.hops.forEach((hop, index) => {
            const a = positions.get(hop.from), b = positions.get(hop.to);
            if (!a || !b) return;
            const pts: Point[] = [a];
            if (a.y !== b.y) {
                // A horizontal run between the two bands, nudged per line so parallel lines do not overdraw.
                const midY = (a.y + b.y) / 2 + (li - lines.length / 2) * 3;
                pts.push({ x: a.x, y: midY }, { x: b.x, y: midY });
            }
            pts.push(b);
            routes.push({ lineId: line.id, index, from: hop.from, to: hop.to, d: roundedPath(pts, 14) });
        });
    });

    return {
        width: w, height: BAND_TOP + Math.max(1, bands.length) * BAND_HEIGHT, bands, positions,
        drawn: drawnStations.map((s) => s.id), routes,
    };
}
