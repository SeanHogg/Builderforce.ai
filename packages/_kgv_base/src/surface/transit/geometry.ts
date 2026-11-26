/**
 * The transit map's drawing primitives: a point, and a polyline as an SVG path with rounded
 * corners (the map's lines turn on a 14px radius). Pure, so a test can pin every coordinate.
 */

import { round } from '../../order';

export interface Point { x: number; y: number }

/** The radius every corner of a line is rounded with. */
export const CORNER = 14;

/** A polyline as an SVG path with rounded corners of radius `r`. */
export function roundedPath(pts: readonly Point[], r: number = CORNER): string {
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

/** A polyline without consecutive duplicate points (a zero-length run has no direction to round). */
export function compact(pts: readonly Point[]): Point[] {
    const out: Point[] = [];
    for (const p of pts) {
        const last = out[out.length - 1];
        if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
    }
    return out;
}

/** The middle of a polyline by length. */
export function midpoint(pts: readonly Point[]): Point {
    if (pts.length === 0) return { x: 0, y: 0 };
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    let left = total / 2;
    for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!, b = pts[i]!, len = Math.hypot(b.x - a.x, b.y - a.y);
        if (left <= len && len > 0) return { x: round(a.x + ((b.x - a.x) * left) / len), y: round(a.y + ((b.y - a.y) * left) / len) };
        left -= len;
    }
    return pts[pts.length - 1]!;
}
