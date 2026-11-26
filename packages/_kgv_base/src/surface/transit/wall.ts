/**
 * The HTTP boundary: where a hop enters a station that serves HTTP routes (a file with a
 * `routes` badge) from a station that does not, the request crosses a process boundary. The
 * map draws a short wall across the line just before that station. Pure.
 */

import type { KNode } from '@seanhogg/builderforce-memory/knowledge';
import { round } from '../../order';
import type { Station } from '../stations';
import type { HopRoute } from './corridors';
import type { Point } from './geometry';

export const WALL_LENGTH = 44;
const APPROACH = 34;

export interface Wall { a: Point; b: Point; label: Point }

/** The stations holding a file that serves routes. */
export function routeStations(stations: readonly Station[], index: ReadonlyMap<string, KNode>): Set<string> {
    return new Set(stations.filter((s) => s.refs.some((ref) => index.get(ref)?.badges?.routes !== undefined)).map((s) => s.id));
}

export function httpWalls(routes: readonly HopRoute[], serving: ReadonlySet<string>): Wall[] {
    const seen = new Set<string>();
    const walls: Wall[] = [];
    for (const r of routes) {
        if (!serving.has(r.to) || serving.has(r.from) || r.pts.length < 2) continue;
        const end = r.pts[r.pts.length - 1]!, prev = r.pts[r.pts.length - 2]!;
        const len = Math.hypot(end.x - prev.x, end.y - prev.y);
        if (len === 0) continue;
        const ux = (end.x - prev.x) / len, uy = (end.y - prev.y) / len;
        const back = Math.min(APPROACH, len / 2);
        const c = { x: end.x - ux * back, y: end.y - uy * back };
        const key = `${round(c.x)},${round(c.y)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const h = WALL_LENGTH / 2;
        walls.push({ a: { x: round(c.x - uy * h), y: round(c.y + ux * h) }, b: { x: round(c.x + uy * h), y: round(c.y - ux * h) }, label: { x: round(c.x + 6), y: round(c.y - h - 4) } });
    }
    return walls;
}
