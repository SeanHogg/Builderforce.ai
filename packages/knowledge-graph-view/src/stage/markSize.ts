/**
 * A mark's DRAWN size (PRD 43 B3): its world half-size times the zoom, never under the placement's `minMarkPx` floor
 * (CSS px across). The ONE formula: the anchored card, a station pin, the selection ring and the semantic-zoom bands
 * read it, and the marks vertex shader applies the same floor (`marks/shader.ts`, `uMinMarkPx` per placement set, blended
 * across a tween) — so on a settled placement everything sized by a mark agrees with what is drawn. Pure.
 */

import type { Placement } from './types';

/** The drawn half-size in CSS px of a mark of world half-size `scale` (0 = hidden stays 0). */
export function drawnHalfPx(scale: number, pxPerWorld: number, minMarkPx = 0): number {
    if (!(scale > 0)) return 0;
    return Math.max(scale * pxPerWorld, minMarkPx / 2);
}

/** Slot `slot`'s drawn half-size in CSS px under `pxPerWorld`. */
export const slotHalfPx = (p: Pick<Placement, 'scale' | 'minMarkPx'>, slot: number, pxPerWorld: number): number =>
    drawnHalfPx(p.scale[slot] ?? 0, pxPerWorld, p.minMarkPx ?? 0);
