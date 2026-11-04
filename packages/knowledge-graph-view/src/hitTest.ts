/**
 * Which node a pointer lands on: the NEAREST centre within the hit radius, in SVG units. Dots overlap and a
 * thumb-sized target is bigger than a dot, so the DOM stacking order must never decide; distance does. Ties go
 * to the higher importance, then the smaller id. Pure; shared by the 2D graph and the mind map.
 */

import { cmp } from './order';

export interface HitCandidate { id: string; x: number; y: number; importance: number }

export function nearestHit(candidates: readonly HitCandidate[], x: number, y: number, radius: number): string | null {
    let best: HitCandidate | null = null;
    let bestD = radius * radius;
    for (const c of candidates) {
        const d = (c.x - x) ** 2 + (c.y - y) ** 2;
        if (d > bestD) continue;
        if (!best || d < bestD || c.importance > best.importance || (c.importance === best.importance && cmp(c.id, best.id) < 0)) {
            best = c;
            bestD = d;
        }
    }
    return best ? best.id : null;
}
