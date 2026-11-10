/**
 * The semantic-zoom band step (PRD 43 B1a rules 9–10), read from the ONE table (`ZOOM_BANDS` in `labels/lod.ts`): given
 * the band on show, how big the mark under the zoom point is drawn (`focusPx`, a candidate to go into) and how big the
 * band's parent mark is drawn (`parentPx`), the band to show next. Entering wins over leaving; a band is left only below
 * its own `exitPx`, entered only at the next band's `enterPx`, so the gap between them is the hysteresis and one step
 * moves at most one band. Also: which mark is "under the zoom point", and the zoom that draws a mark at a band's
 * threshold (the "Go inside" shortcut flies there). Pure.
 */

import { ZOOM_BANDS, ZOOM_OVERSHOOT, type ZoomBand } from '../labels/lod';
import type { Projector } from '../pick';
import type { Placement } from '../types';

export const bandOf = (index: number): ZoomBand => ZOOM_BANDS[Math.max(0, Math.min(ZOOM_BANDS.length - 1, index))]!.band;

/** The band to show after a zoom frame. `last` caps it (a Sequence has no code band). */
export function stepBand(current: number, focusPx: number, parentPx: number, last: number = ZOOM_BANDS.length - 1): number {
    const next = ZOOM_BANDS[current + 1];
    if (current < last && next && focusPx >= next.enterPx) return current + 1;
    if (current > 0 && parentPx < ZOOM_BANDS[current]!.exitPx) return current - 1;
    return current;
}

/** The Sequence's `req.lod` for a band (0 systems, 1 classes, 2 methods; the code band reads the method band). */
export const sequenceLodOf = (band: number): number => Math.max(0, Math.min(2, band));

/** A slot's drawn diameter in CSS px under `pxPerWorld` (scale is the mark's half-size). */
export const drawnPx = (p: Pick<Placement, 'scale'>, slot: number, pxPerWorld: number): number => 2 * (p.scale[slot] ?? 0) * pxPerWorld;

export interface Focus { slot: number; px: number }

const out = new Float64Array(2);

/**
 * The shown slot of `slots` nearest the screen point `at`, if it is on screen and within `reach` of it — `reach` px, or
 * its own drawn radius when that is larger (a mark under the pointer is always the focus). Null when none is.
 */
export function focusOf(p: Placement, projector: Projector, slots: Iterable<number>, at: readonly [number, number], reach: number): Focus | null {
    let best: Focus | null = null, bestD = Infinity;
    for (const slot of slots) {
        if (slot < 0 || !((p.scale[slot] ?? 0) > 0)) continue;
        if (!projector.project(p.position[slot * 3]!, p.position[slot * 3 + 1]!, p.position[slot * 3 + 2]!, out)) continue;
        const x = out[0]!, y = out[1]!;
        if (x < 0 || y < 0 || x > projector.width || y > projector.height) continue;
        const px = drawnPx(p, slot, projector.pxPerWorld);
        const d = Math.hypot(x - at[0], y - at[1]);
        if (d > Math.max(reach, px / 2) || d >= bestD) continue;
        best = { slot, px }; bestD = d;
    }
    return best;
}

/** The px-per-world zoom that draws a mark of half-size `scale` at band `band`'s threshold, with the overshoot. */
export function zoomForBand(band: number, scale: number): number {
    const step = ZOOM_BANDS[Math.max(0, Math.min(ZOOM_BANDS.length - 1, band))]!;
    return (step.enterPx * ZOOM_OVERSHOOT) / Math.max(2 * scale, 1e-6);
}
