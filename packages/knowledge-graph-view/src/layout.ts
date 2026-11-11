/**
 * Where the view reflows, by CONTAINER width (the view is a canvas surface, a webview tab and a
 * side panel, so the viewport says nothing). ONE place for every breakpoint; nothing else
 * spells these numbers.
 *
 *  - below PHONE_WIDTH   the phone: the Lines list is a sheet, the node a bottom sheet.
 *  - below COMPACT_WIDTH  compact: the 60-node focus, panels stack, the node is a bottom sheet.
 *  - below PANELS_MENU_WIDTH  the header's Panels group is one "Panels ▾" menu (keeps the row one line).
 *  - below LINES_STACK_WIDTH  the 250px Lines rail stacks: its list sits above the path strip.
 *  - below ACT_STACK_WIDTH    the 330px Act rail moves under the scene, full width.
 */

import { COMPACT_WIDTH } from './graphModel';

export { COMPACT_WIDTH };
export const PHONE_WIDTH = 480;
export const PANELS_MENU_WIDTH = 900;
export const LINES_STACK_WIDTH = 840;
export const ACT_STACK_WIDTH = 1100;

export interface SurfaceLayout {
    /** Narrower than COMPACT_WIDTH. */
    compact: boolean;
    /** Narrower than PHONE_WIDTH. */
    phone: boolean;
    /** The Act rail is a section under the scene. */
    actBelow: boolean;
    /** The Lines list is stacked above the path strip (a phone has it in a sheet instead). */
    linesStacked: boolean;
    /** The Panels group is one menu. */
    panelsMenu: boolean;
}

/** The least a stacked scene draws in, CSS px, and its share of the viewport's height when that is more. */
export const SCENE_MIN_PX = 320;
export const SCENE_STACKED_VH = 60;
/** The overlay's fallback height before `SceneOverlay` publishes `--kg-scene-top` (the scene box's own `top`). */
export const SCENE_TOP_FALLBACK = '88px';

/**
 * The scene region's `min-height`. Side by side (no `actBelow`) the row's flex gives it the height. Stacked, the region
 * sizes itself: its DRAWING box (below the floating overlay, which a non-phone layout lays over the region's top) must
 * get at least {@link SCENE_MIN_PX} or {@link SCENE_STACKED_VH} of the viewport — reserving only 320px for overlay AND
 * scene left a ~230px strip, and the stage overflowed it.
 */
export function sceneMinHeight(l: SurfaceLayout): number | string {
    if (!l.actBelow) return 0;
    const draw = `max(${SCENE_MIN_PX}px, ${SCENE_STACKED_VH}vh)`;
    return l.phone ? draw : `calc(${draw} + var(--kg-scene-top, ${SCENE_TOP_FALLBACK}))`;
}

/** `width` 0 (not measured yet) reads as the full layout. */
export function layoutOf(width: number): SurfaceLayout {
    const known = width > 0;
    return {
        compact: known && width < COMPACT_WIDTH,
        phone: known && width < PHONE_WIDTH,
        actBelow: known && width < ACT_STACK_WIDTH,
        linesStacked: known && width < LINES_STACK_WIDTH,
        panelsMenu: known && width < PANELS_MENU_WIDTH,
    };
}
