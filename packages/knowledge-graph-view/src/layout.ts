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
