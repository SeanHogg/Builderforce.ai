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
