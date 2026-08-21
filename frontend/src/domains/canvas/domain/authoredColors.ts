/**
 * The colours a PERSON picks, as opposed to the colours a theme decides.
 *
 * `<input type="color">` accepts one thing: a seven-character `#rrggbb`. Give it
 * `var(--coral-bright)` and the control silently shows black, discards the
 * intended default, and writes black into the object the moment anyone touches
 * it — which is exactly what had happened to the drawing stroke and the website
 * accent after an earlier token sweep passed over them.
 *
 * So these are literals ON PURPOSE, and this file is the one place the design
 * ratchet exempts for that reason (see `check-design-scale.mjs`). The test for
 * belonging here is narrow: the value is **persisted into the object's data** as
 * the author's choice and later rendered back as-is. A colour the THEME owns —
 * a surface, an ink, a board hue — is a token and lives in
 * `CreationCanvas.module.css` with the rest of the board's palette.
 *
 * Each default matches the token it is named after at the value the token holds
 * in dark, because that is the board a new object is most often created on.
 */

/** Default accent for a generated website object (matches `--coral-bright`). */
export const AUTHORED_WEBSITE_ACCENT = '#4d9eff';

/** Default stroke for a freehand drawing object (matches `--indigo-bright`). */
export const AUTHORED_DRAWING_STROKE = '#7c83fd';

/** Default fill for a frame — a pale tint, so cards on it still read as raised. */
export const AUTHORED_FRAME_FILL = '#f8f6ff';

/** Default border for a frame, one step deeper than its fill. */
export const AUTHORED_FRAME_BORDER = '#9d8bea';

/** The floor every `<input type="color">` falls back to when a field declares no
 *  `defaultColor` of its own — the control still needs SOME value to open the native
 *  picker at. Not meant to be seen; every real color field should declare its own. */
export const AUTHORED_COLOR_FALLBACK = '#000000';

/**
 * Sticky-note pigment — the palette a note, a shape and a stencil are all drawn from.
 *
 * Moved here from `components/canvas/canvasModel.ts`, which is deleted: the knowledge
 * board this list originally belonged to folded into the Creation Canvas, and the
 * pigments outlived the board because they are the one part of it that was never
 * board-specific. Nothing about the reasoning changed — the value a person picks here is
 * WRITTEN INTO `stickyColor` and rendered back as-is, so it is the author's choice rather
 * than the theme's, which is the exact test this module exists to apply.
 *
 * Every one is a PALE pigment, which is why the ink on a sticky is always
 * `--canvas-ink-on-light` (a surface that is light in BOTH themes) rather than the
 * theme's own foreground.
 */
export const STICKY_COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#ddd6fe'];
