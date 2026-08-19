/**
 * THE canvas's answer to "at what width is this being looked at?" — one vocabulary and
 * one set of widths, for every surface that frames a document.
 *
 * ── WHY THIS IS ONE MODULE AND NOT THREE CONSTANTS ───────────────────────────────
 * It was three. `canvasApp.ts` declared `CANVAS_APP_VIEWPORTS` for the app runtime,
 * `canvasWebPage.ts` declared `WEB_PAGE_VIEWPORT_WIDTHS` plus its own `WebPageViewport`
 * coercion for a framed live page, and the site surface borrowed the app's type while the
 * stylesheet carried a THIRD set of widths (`--app-width` / `--site-width`) that nothing
 * checked against either. Three lists of the same three words is how a canvas ends up
 * calling 390px a phone on one surface and 375px a phone on the next, and it is how the
 * defect this module was extracted to fix survived: the CSS widths and the frame widths
 * were never the same numbers, so "Desktop" and "Tablet" could look identical.
 *
 * ── WHY THE WIDTHS ARE REAL PIXELS AND NOT `min(100%, …)` ────────────────────────
 * A preview is only worth having if it answers the question the reader asked. Shrinking a
 * frame with `max-width` hands the framed document the SMALLER width, so its own media
 * queries fire for a phone and the "Desktop" reading shows a mobile layout — the frame
 * looks wide and the page inside it does not. The frame is therefore always laid out at
 * the true device width and scaled into the space available (`CanvasDeviceFrame`), which
 * is what makes desktop, tablet and phone visibly different rather than three widths of
 * the same responsive collapse.
 */

export const CANVAS_VIEWPORTS = ['desktop', 'tablet', 'mobile'] as const;

export type CanvasViewport = (typeof CANVAS_VIEWPORTS)[number];

/**
 * The width each reading is DRAWN at, in CSS pixels of the framed document.
 *
 * 1280 is the desktop breakpoint essentially every CSS framework treats as "a laptop";
 * 834 and 390 are the portrait logical widths of the current iPad and iPhone. They are
 * the widths a responsive page is written against, which is the only reason to pick
 * numbers at all — a preview at an invented width tests a layout nobody ships.
 */
export const CANVAS_VIEWPORT_WIDTHS: Readonly<Record<CanvasViewport, number>> = {
  desktop: 1280,
  tablet: 834,
  mobile: 390,
};

/** Coerce a persisted or model-authored `viewport` field to one this canvas can draw. */
export function canvasViewport(value: unknown): CanvasViewport {
  return value === 'tablet' || value === 'mobile' ? value : 'desktop';
}
