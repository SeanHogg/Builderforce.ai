/**
 * Where the view reflows, by CONTAINER width (the view is a canvas surface, a webview tab and a
 * side panel, so the viewport says nothing). ONE place for every breakpoint; nothing else
 * spells these numbers.
 *
 *  - below PHONE_WIDTH   the phone: the Lines list is a sheet, the node a bottom sheet.
 *  - below COMPACT_WIDTH  compact: the 60-node focus, the node is a bottom sheet.
 *  - at or under DRAWER_SHEET_WIDTH  the design prototype's `max-width: 900px` rules: the header wraps (the spine on its own row, the search button gone,
 *    a Code | Picture switch appears) and the drawer is a bottom sheet over the stage.
 *  - below LINES_STACK_WIDTH  the 250px Lines rail stacks: its list sits above the path strip.
 */

import { COMPACT_WIDTH } from './graphModel';

export { COMPACT_WIDTH };
export const PHONE_WIDTH = 480;
export const DRAWER_SHEET_WIDTH = 900;
export const LINES_STACK_WIDTH = 840;

export interface SurfaceLayout {
    /** Narrower than COMPACT_WIDTH. */
    compact: boolean;
    /** Narrower than PHONE_WIDTH. */
    phone: boolean;
    /** The Lines list is stacked above the path strip (a phone has it in a sheet instead). */
    linesStacked: boolean;
    /** At or under DRAWER_SHEET_WIDTH: the wrapped header, the Code | Picture switch and the drawer as a bottom sheet. */
    drawerSheet: boolean;
}

/** The overlay's fallback height before `SceneOverlay` publishes `--kg-scene-top` (the scene box's own `top`). */
export const SCENE_TOP_FALLBACK = '88px';

/** `width` 0 (not measured yet) reads as the full layout. */
export function layoutOf(width: number): SurfaceLayout {
    const known = width > 0;
    return {
        compact: known && width < COMPACT_WIDTH,
        phone: known && width < PHONE_WIDTH,
        linesStacked: known && width < LINES_STACK_WIDTH,
        drawerSheet: known && width <= DRAWER_SHEET_WIDTH,
    };
}
