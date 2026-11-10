/**
 * The 2D graph's label font size in CSS pixels. The SVG pan/zoom hook that lived here retired with `Graph2D` (PRD 43 B8);
 * the stage's equivalent is `stage/labels/lod.ts` `CAPTION_FONT_PX`. Kept only for the Graph placement's parity test,
 * which recomputes the 2D graph's reference captions from it.
 */

export const FONT_PX = 11;
