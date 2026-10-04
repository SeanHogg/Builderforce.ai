/* ── THE READINGS AND THE WIDTHS ──────────────────────────────────────────────────
   A surface with a runtime contributes two segmented groups into the ONE command bar:
   which reading of the artifact is on screen, and which width the reader is checking.
   They used to be worded — "Preview Code Console" beside "Desktop Tablet Phone" — which
   is six words in a bar whose every other control is a 15px glyph, and enough of them to
   wrap the bar onto a second row that then sat over the prompt. The words survive as the
   accessible name and the tooltip; only the drawing changed. */

/** Preview — the artifact as its reader sees it. An eye rather than a play triangle: Run
 *  is the triangle on this same bar, and two triangles that mean different things is the
 *  ambiguity the icon set exists to remove. */
export function PreviewReadingIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M1.4 8s2.5-4.3 6.6-4.3S14.6 8 14.6 8s-2.5 4.3-6.6 4.3S1.4 8 1.4 8Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <circle cx="8" cy="8" r="1.9" fill="currentColor" />
  </svg>;
}

/** Code — the artifact as its author wrote it. */
export function CodeReadingIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.6 4.6 2.2 8l3.4 3.4M10.4 4.6 13.8 8l-3.4 3.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Console — what the artifact SAID while it ran. A prompt caret and a line, the shape
 *  every terminal in the product already uses. */
export function ConsoleReadingIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M4.4 6.4 6.6 8.4l-2.2 2M8.6 10.7h3.1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Desktop width. */
export function ViewportDesktopIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.4" y="2.6" width="13.2" height="8.6" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M5.6 13.6h4.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** Tablet width. */
export function ViewportTabletIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="3.2" y="1.8" width="9.6" height="12.4" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M6.9 12.2h2.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** Phone width. Narrower than the tablet by more than a stroke, because at 15px two
 *  rounded rectangles a pixel apart are the same icon drawn twice. */
export function ViewportMobileIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="4.9" y="1.6" width="6.2" height="12.8" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M7.4 12.3h1.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

/** The universal-access glyph used by every canvas that publishes a text outline. */
export function AccessibleOutlineIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.6" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="8" cy="3.9" r="1.15" fill="currentColor" />
    <path d="M4.6 6.1 8 6.9l3.4-.8M8 6.9v3.1l-1.5 3M8 10h1.4l1.5 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}
