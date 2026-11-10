/**
 * The width the transit map is LAID OUT for: the measured width, held until it moves by more than a
 * page scrollbar. A scrollbar appearing on a scrolling ancestor (the map got taller than the panel)
 * takes ~15–17px from every box inside it, and the map's own height decides whether that scrollbar
 * shows; laying out again for each toggle fed the toggle (the "Laying out…" flicker). Measuring a
 * different box cannot help (the ancestor's scrollbar narrows them all) and `scrollbar-gutter`
 * belongs to an ancestor this package does not own, so the slack lives here. A real resize (a panel
 * dragged, a phone rotated) moves the width by far more and is followed; within the slack the map
 * scales to its box (`maxWidth: 100%`). The trade-off, accepted: a REAL shrink of 24px or less (a
 * small panel drag) is not laid out again either; the map stays laid out for the wider box and is
 * scaled down by up to the slack (text and marks a few percent smaller) until a larger change. Floored, so a fractional measurement never lays out a map a
 * fraction of a pixel wider than its box (which would add a sideways scrollbar of its own).
 */

import { useState } from 'react';

/** Wider than any classic scrollbar (Windows draws 17px at 100%), far below a real resize. */
export const SCROLLBAR_SLACK = 24;

/** The next held width: the first measurement is taken, then only a change past the slack. 0 (not measured) never replaces one. */
export function steadyWidth(held: number, measured: number, slack = SCROLLBAR_SLACK): number {
    const next = Math.floor(measured);
    if (next <= 0) return held;
    if (held <= 0) return next;
    return Math.abs(next - held) > slack ? next : held;
}

/** `steadyWidth` over renders: the width a layout should be keyed on. */
export function useSteadyWidth(measured: number): number {
    const [held, setHeld] = useState(() => steadyWidth(0, measured));
    const next = steadyWidth(held, measured);
    // The derived-state pattern: set during render, React re-renders at once without committing the stale value.
    if (next !== held) setHeld(next);
    return next;
}
