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

/** The Lines rail beside the scene, and the drawer as a right-hand column (above the sheet width). */
export const LINES_RAIL_WIDTH = 250;
export const DRAWER_WIDTH = 340;
/** A collapsed dock keeps this much of itself: a thin rail the edge chevron sits on. */
export const DOCK_RAIL = 28;
/**
 * The stage box from which the code pane splits beside the picture (`stage/overlay/CodeDock`'s `SPLIT_MIN_PX` must equal it). Under it the stage shows
 * ONE of the two, and the header's Code | Picture switch picks which.
 */
export const CODE_SPLIT_WIDTH = 901;

/** What sits beside the stage in the scene row. */
export interface SceneRow {
    /** The Lines dock beside the scene: shown, collapsed to its rail, or not there (stacked, a phone, no lines). */
    lines: 'shown' | 'rail' | 'none';
    /** The drawer is open as a column (not the bottom sheet). */
    drawerColumn: boolean;
}

/** The stage box's width in a container `width` wide: what the Lines dock and the drawer column leave. 0 (unmeasured) stays 0. */
export function stageWidthOf(width: number, row: SceneRow): number {
    if (width <= 0) return 0;
    const lines = row.lines === 'shown' ? LINES_RAIL_WIDTH : row.lines === 'rail' ? DOCK_RAIL : 0;
    return Math.max(0, width - lines - (row.drawerColumn ? DRAWER_WIDTH : 0));
}

/** The stage shows the code pane OR the picture, never both: the code pane is on and the stage box is too narrow to split it. */
export const onePaneStage = (stageWidth: number): boolean => stageWidth > 0 && stageWidth < CODE_SPLIT_WIDTH;

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
