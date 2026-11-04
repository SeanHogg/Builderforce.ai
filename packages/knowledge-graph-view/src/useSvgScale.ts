/**
 * Screen-relative sizes inside a pan/zoom SVG: one CSS pixel in viewBox units (`perPx`) and the label font in those units.
 * `perPx` snaps to a third of an octave, so layers memoised on it do not redraw on every wheel notch.
 */

import type { ViewBox } from './usePanZoom';

export const FONT_PX = 11;
/** The radius of a node's hit target, in CSS pixels (a thumb, not the dot). */
export const HIT_PX = 20;

export interface SvgScale { perPx: number; font: number }

export function useSvgScale(view: ViewBox | null, size: { width: number; height: number }): SvgScale {
    const raw = view && size.width > 0 && size.height > 0 ? Math.max(view.w / size.width, view.h / size.height) : 0.1;
    const perPx = 2 ** (Math.round(Math.log2(raw) * 3) / 3);
    return { perPx, font: FONT_PX * perPx };
}
