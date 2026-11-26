/**
 * Corridor routing: a hop between two bands leaves its station, runs along the corridor in the
 * gap between bands, and drops into the next station. Lines that share a gap are spread over
 * lanes inside it (so parallel lines never overdraw), and a hop that crosses a band between
 * its two ends uses a free column between that band's stations. Every corner is rounded. Pure
 * and deterministic.
 */

import { compact, CORNER, midpoint, roundedPath, type Point } from './geometry';

/** Room between two lanes of one corridor. */
export const LANE_GAP = 6;
/** How far below its row a hop within one band detours. */
const ROW_DETOUR = 34;
/** Clearance a column needs from a station of a band it crosses. */
const COLUMN_CLEARANCE = 30;

export interface CorridorBand { y: number; h: number }
export interface CorridorLine { id: string; hops: ReadonlyArray<{ from: string; to: string }> }

export interface HopRoute {
    lineId: string;
    index: number;
    from: string;
    to: string;
    d: string;
    pts: Point[];
    mid: Point;
}

export interface CorridorInput {
    lines: readonly CorridorLine[];
    positions: ReadonlyMap<string, Point>;
    bands: readonly CorridorBand[];
    /** Station id → index of its band. */
    bandIndex: ReadonlyMap<string, number>;
}

/** The gap a hop uses to leave band `from` towards band `to` (gap g lies under band g). */
const leaveGap = (from: number, to: number): number => (from < to ? from : from - 1);
const enterGap = (from: number, to: number): number => (from < to ? to - 1 : to);

const pairKey = (a: string, b: string): string => (a < b ? `pair:${a}\0${b}` : `pair:${b}\0${a}`);

function laneTable(input: CorridorInput): Map<string, Map<string, number>> {
    // corridor key → line ids using it, in line order.
    const users = new Map<string, string[]>();
    const note = (key: string, lineId: string) => {
        const list = users.get(key) ?? users.set(key, []).get(key)!;
        if (!list.includes(lineId)) list.push(lineId);
    };
    for (const line of input.lines) for (const hop of line.hops) {
        const a = input.bandIndex.get(hop.from), b = input.bandIndex.get(hop.to);
        if (a === undefined || b === undefined) continue;
        if (a === b) note(`row:${a}`, line.id);
        else { note(`gap:${leaveGap(a, b)}`, line.id); note(`gap:${enterGap(a, b)}`, line.id); }
        // Lines that run between the same two stations also share the legs at the stations, straight or not.
        note(pairKey(hop.from, hop.to), line.id);
    }
    const out = new Map<string, Map<string, number>>();
    for (const [key, ids] of users) {
        const offsets = new Map<string, number>();
        ids.forEach((id, rank) => offsets.set(id, (rank - (ids.length - 1) / 2) * LANE_GAP));
        out.set(key, offsets);
    }
    return out;
}

/** A column between the stations of the bands a hop crosses, nearest `want`, clear of every station there. */
export function freeColumn(want: number, crossed: readonly number[][]): number {
    const xs = crossed.flat().sort((a, b) => a - b);
    const candidates = [want];
    for (let i = 0; i < xs.length - 1; i++) candidates.push((xs[i]! + xs[i + 1]!) / 2);
    if (xs.length > 0) candidates.push(xs[0]! - COLUMN_CLEARANCE * 1.5, xs[xs.length - 1]! + COLUMN_CLEARANCE * 1.5);
    // The two outer candidates are always clear of every station, so a dense row sends the line round its end.
    const clear = candidates.filter((c) => xs.every((x) => Math.abs(x - c) >= COLUMN_CLEARANCE));
    return clear.sort((p, q) => Math.abs(p - want) - Math.abs(q - want) || p - q)[0]!;
}

export function routeLines(input: CorridorInput): HopRoute[] {
    const lanes = laneTable(input);
    const rows = input.bands.map((_, bi) => [...input.bandIndex].filter(([, b]) => b === bi).flatMap(([id]) => input.positions.get(id)?.x ?? []));
    const lane = (key: string, lineId: string) => lanes.get(key)?.get(lineId) ?? 0;
    const channel = (gap: number, lineId: string) => {
        const band = input.bands[gap]!;
        return band.y + band.h + lane(`gap:${gap}`, lineId);
    };
    const routes: HopRoute[] = [];
    for (const line of input.lines) line.hops.forEach((hop, index) => {
        const at = input.positions.get(hop.from), bt = input.positions.get(hop.to);
        const ba = input.bandIndex.get(hop.from), bb = input.bandIndex.get(hop.to);
        if (!at || !bt || ba === undefined || bb === undefined) return;
        // Two lines between the same pair of stations leave them side by side: across the run for a row, along the row for a column.
        const po = lane(pairKey(hop.from, hop.to), line.id);
        const sameRow = ba === bb;
        const a = sameRow ? { x: at.x, y: at.y + po } : { x: at.x + po, y: at.y };
        const b = sameRow ? { x: bt.x, y: bt.y + po } : { x: bt.x + po, y: bt.y };
        let pts: Point[];
        if (ba === bb) {
            const between = rows[ba]!.some((x) => x > Math.min(a.x, b.x) + 1 && x < Math.max(a.x, b.x) - 1);
            const y = a.y + ROW_DETOUR + lane(`row:${ba}`, line.id);
            pts = between || a.y !== b.y ? [a, { x: a.x, y }, { x: b.x, y }, b] : [a, b];
        } else {
            const c1 = channel(leaveGap(ba, bb), line.id), c2 = channel(enterGap(ba, bb), line.id);
            if (c1 === c2 || leaveGap(ba, bb) === enterGap(ba, bb)) {
                pts = a.x === b.x ? [a, b] : [a, { x: a.x, y: c1 }, { x: b.x, y: c1 }, b];
            } else {
                const lo = Math.min(ba, bb), hi = Math.max(ba, bb);
                const crossed = rows.slice(lo + 1, hi);
                const gx = freeColumn((a.x + b.x) / 2, crossed);
                pts = [a, { x: a.x, y: c1 }, { x: gx, y: c1 }, { x: gx, y: c2 }, { x: b.x, y: c2 }, b];
            }
        }
        const clean = compact(pts);
        routes.push({ lineId: line.id, index, from: hop.from, to: hop.to, d: roundedPath(clean, CORNER), pts: clean, mid: midpoint(clean) });
    });
    return routes;
}
