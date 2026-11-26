/**
 * linkCollapse (PRD 43 C5): the links of a side follow the marks the side does not have. A link has no slot ids, only
 * points, so an absent mark is matched by its FOOTPRINT (the spot and radius the placement gave it), not an exact centre:
 *   - a Map route or edge end inside an absent mark's footprint moves to the mark's anchor (a route's INTERIOR point does
 *     too when the absent mark is a station: the route passes through it);
 *   - a Sequence absent mark has a lifeline (a vertical `edge` hanging from it): the lifeline and every message that ends
 *     on that column, within its extent, are hidden (collapsed to a point), because the side has no such participant.
 * A spot a shown mark's footprint also covers is not the absent one's alone: its links stay. Only a batch something moves
 * in is copied; `runLength` is recomputed for the polylines that moved. Pure.
 */

import type { LinkBatch } from '../../stage/types';

/** An absent mark as the links see it. */
export interface CollapseSource {
    x: number; y: number; z: number;
    /** Footprint radius (ground units). */
    r: number;
    /** Where its links go (ground x, z); null when the mark has no shown anchor (the lifeline rule still applies). */
    to: readonly [number, number] | null;
    /** A station: a route passing THROUGH it (an interior point) moves too. */
    station: boolean;
}
/** A shown mark: a spot it stands on keeps its links. */
export interface CollapseShown { x: number; z: number; r: number }

export const FOOTPRINT_EPS = 0.01;

interface Life { source: CollapseSource; zEnd: number }

/** A grid over points with radii, so a lookup is the 3x3 cells around the query rather than every mark. */
class Spots<T extends { x: number; z: number; r: number }> {
    private readonly cells = new Map<string, T[]>();
    private readonly size: number;
    constructor(items: readonly T[]) {
        this.size = Math.max(1, ...items.map((i) => i.r));
        for (const it of items) {
            const key = this.key(it.x, it.z);
            const list = this.cells.get(key);
            if (list) list.push(it); else this.cells.set(key, [it]);
        }
    }
    private key(x: number, z: number): string { return `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`; }
    /** The items whose footprint holds (x, z), nearest first. */
    covering(x: number, z: number): T[] {
        const cx = Math.floor(x / this.size), cz = Math.floor(z / this.size), out: { it: T; d: number }[] = [];
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            for (const it of this.cells.get(`${cx + i},${cz + j}`) ?? []) {
                const d = Math.hypot(it.x - x, it.z - z);
                if (d <= it.r) out.push({ it, d });
            }
        }
        return out.sort((a, b) => a.d - b.d).map((o) => o.it);
    }
}

/** The vertical two-point `edge` polylines (a Sequence lifeline): [x, y, z0, z1]. */
function lifelinesOf(links: readonly LinkBatch[]): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    for (const b of links) {
        if (b.family !== 'edge') continue;
        forEachRun(b.points, (a, e) => {
            if (e - a !== 1) return;
            const p = b.points, x = p[a * 3]!, y = p[a * 3 + 1]!;
            if (p[e * 3] === x && p[e * 3 + 1] === y && p[e * 3 + 2] !== p[a * 3 + 2]) out.push([x, y, p[a * 3 + 2]!, p[e * 3 + 2]!]);
        });
    }
    return out;
}

/** Each polyline as an inclusive point range [a, e]: a NaN triple breaks it. */
function forEachRun(points: Float32Array, visit: (a: number, e: number) => void): void {
    const n = points.length / 3;
    let a = -1;
    for (let i = 0; i <= n; i++) {
        const gap = i === n || Number.isNaN(points[i * 3]!);
        if (!gap && a < 0) a = i;
        if (gap && a >= 0) { visit(a, i - 1); a = -1; }
    }
}

export function collapseLinks(links: LinkBatch[], sources: readonly CollapseSource[], shown: readonly CollapseShown[]): LinkBatch[] {
    if (sources.length === 0) return links;
    const lines = lifelinesOf(links);
    const lives: Life[] = [], plain: CollapseSource[] = [];
    for (const s of sources) {
        const line = lines.find(([x, y, z0]) => Math.abs(x - s.x) <= s.r && Math.abs(y - s.y) <= s.r && z0 >= s.z - s.r && z0 <= s.z + 2 * s.r);
        if (line) lives.push({ source: s, zEnd: Math.max(line[2], line[3]) });
        else if (s.to) plain.push(s);
    }
    if (lives.length === 0 && plain.length === 0) return links;
    const sourceSpots = new Spots(plain), shownSpots = new Spots(shown);
    const onLife = (x: number, y: number, z: number): boolean => lives.some(({ source: s, zEnd }) =>
        Math.abs(x - s.x) <= s.r && Math.abs(y - s.y) <= s.r && z >= s.z - s.r && z <= zEnd + s.r);
    const target = (x: number, z: number, interior: boolean): readonly [number, number] | null => {
        if (shownSpots.covering(x, z).length > 0) return null;
        return sourceSpots.covering(x, z).find((s) => !interior || s.station)?.to ?? null;
    };

    return links.map((batch) => {
        const src = batch.points;
        let pts = null as Float32Array | null;
        const moved: [number, number][] = [];
        forEachRun(src, (a, e) => {
            const first = a * 3, last = e * 3;
            let touched = false;
            if (lives.length > 0 && (onLife(src[first]!, src[first + 1]!, src[first + 2]!) || onLife(src[last]!, src[last + 1]!, src[last + 2]!))) {
                for (let i = a + 1; i <= e; i++) {
                    for (let c = 0; c < 3; c++) if (src[i * 3 + c] !== src[first + c]) { pts ??= Float32Array.from(src); pts[i * 3 + c] = src[first + c]!; touched = true; }
                }
            } else if (plain.length > 0) {
                for (let i = a; i <= e; i++) {
                    const to = target(src[i * 3]!, src[i * 3 + 2]!, i !== a && i !== e);
                    if (!to || (src[i * 3] === to[0] && src[i * 3 + 2] === to[1])) continue;
                    pts ??= Float32Array.from(src);
                    pts[i * 3] = to[0]; pts[i * 3 + 2] = to[1];
                    touched = true;
                }
            }
            if (touched) moved.push([a, e]);
        });
        if (!pts) return batch;
        return { ...batch, points: pts, runLength: runLengthOf(batch.runLength, pts, moved) };
    });
}

/** The running lengths with the moved polylines measured again (a batch that carries none keeps none). */
function runLengthOf(old: Float32Array, pts: Float32Array, moved: readonly [number, number][]): Float32Array {
    if (old.length !== pts.length / 3) return old;
    const out = Float32Array.from(old);
    for (const [a, e] of moved) {
        let acc = 0;
        out[a] = 0;
        for (let i = a + 1; i <= e; i++) {
            acc += Math.hypot(pts[i * 3]! - pts[(i - 1) * 3]!, pts[i * 3 + 1]! - pts[(i - 1) * 3 + 1]!, pts[i * 3 + 2]! - pts[(i - 1) * 3 + 2]!);
            out[i] = acc;
        }
    }
    return out;
}
