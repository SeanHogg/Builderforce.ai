/*
 * The canvas icon set.
 *
 * Every canvas surface — the desktop command rail, the phone action rail, the
 * session bar — draws from THIS set, on one 16×16 grid with one stroke weight.
 * The phone rail used to spell its commands with Unicode glyphs (⌗ ⌘ ◱ ⤓), which
 * a phone font renders at whatever size and weight it likes (and often not at
 * all), so the two real icons next to them looked like a different toolbar.
 */
export function MinimapIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="2" width="13" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    <path d="M2 10.5 5.5 7l2.3 2.2L11 5.7l3 3" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
  </svg>;
}

export function CleanLayoutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.75" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="2" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="1.75" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="10" y="9.75" width="4.25" height="4.25" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M8 1v14M1 8h14" stroke="currentColor" strokeWidth="1" strokeDasharray="1.3 1.3" />
  </svg>;
}

export function ThreeDIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.4 14 4.6v6.8L8 14.6 2 11.4V4.6z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2 4.6 8 7.9l6-3.3M8 7.9v6.7" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** The conversation surface: a speech bubble. Drawn on the same 16×16 grid as every
 *  other rail command so the surface switcher reads as one control, not three fonts. */
export function ChatSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 4.1a1.6 1.6 0 0 1 1.6-1.6h8.8A1.6 1.6 0 0 1 14 4.1v5.3a1.6 1.6 0 0 1-1.6 1.6H6.6L3.4 13.6v-2.6a1.6 1.6 0 0 1-1.4-1.6z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M5.2 6.1h5.6M5.2 8.4h3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>;
}

/** The flat board: two connected nodes. The counterpart to `ThreeDIcon` — same objects,
 *  read on a plane instead of in a space. */
export function GraphSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.5" y="2" width="5.4" height="4" rx=".9" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <rect x="9.1" y="10" width="5.4" height="4" rx=".9" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M6.9 4h3.4a1.5 1.5 0 0 1 1.5 1.5V10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** The app surface: a window with a play mark in it. Deliberately NOT a bare triangle —
 *  a play glyph beside "Board" and "Room" reads as "start something", and this tab
 *  answers the same question they do: what am I looking at. The frame is the answer. */
export function AppSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="2.6" width="12.8" height="10.8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M1.6 5.6h12.8" stroke="currentColor" strokeWidth="1.1" />
    <path d="M6.6 7.9v3.2l2.9-1.6z" fill="currentColor" />
  </svg>;
}

export function DepthIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.6 14.4 5 8 8.4 1.6 5z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2.4 8.2 8 11.1l5.6-2.9M2.4 11.4 8 14.3l5.6-2.9" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** Marquee-select: a dashed selection box with a pointer at its corner — the gesture the
 *  toggle hands the primary drag to, drawn as the gesture rather than as a cursor. */
export function MarqueeSelectIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.6" y="1.6" width="9.6" height="9.6" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 1.6" />
    <path d="M8.4 7.6 14.4 10l-2.5.9-.9 2.5z" fill="currentColor" stroke="currentColor" strokeWidth=".9" strokeLinejoin="round" />
  </svg>;
}

export function LayerGuidesIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.7 14.2 5 8 8.3 1.8 5z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M2.4 8.6 8 11.6l5.6-3" fill="none" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.6 1.4" strokeLinejoin="round" />
  </svg>;
}

export function DropToLayersIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 1.6v6.2m0 0L5.7 5.6M8 7.8l2.3-2.2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8 9.6 14.2 12.6 8 15.6 1.8 12.6z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
  </svg>;
}

export function ZoomInIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M8 3.2v9.6M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

export function ZoomOutIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.2 8h9.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>;
}

export function ResetViewIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M13.2 1.9v3h-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Frame the whole board — the phone rail's counterpart to React Flow's fit-view. */
export function FitViewIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 5.6V2.6h3M11 2.6h3v3M14 10.4v3h-3M5 13.4H2v-3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    <rect x="5.9" y="6.1" width="4.2" height="3.8" rx=".8" fill="none" stroke="currentColor" strokeWidth="1.15" />
  </svg>;
}

/** Take the canvas full screen. */
export function FullscreenIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.2 6V2.2h3.8M10 2.2h3.8V6M13.8 10v3.8H10M6 13.8H2.2V10" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Leave full screen — the same corners, folded inwards. */
export function ExitFullscreenIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M6.2 2.4v3.8H2.4M9.8 2.4v3.8h3.8M13.6 9.8H9.8v3.8M6.2 13.6V9.8H2.4" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** The stacked-sheets glyph for a canvas that publishes a file library. */
export function CanvasFilesIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.4 2.2h4l2.4 2.4v7a1 1 0 0 1-1 1H5.4a1 1 0 0 1-1-1v-8.4a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M9.2 2.4v2.4h2.4M6.4 8.2h3.2M6.4 10.2h3.2" fill="none" stroke="currentColor" strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Connected cloud storage — a cloud over a folder, so it reads as "files that
 * are not on this machine" rather than as the session's own file library. */
export function CanvasDriveIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.4 12.4V5.1a.9.9 0 0 1 .9-.9h2.9l1.2 1.4h4.3a.9.9 0 0 1 .9.9v5.9a.9.9 0 0 1-.9.9H3.3a.9.9 0 0 1-.9-.9Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    <path d="M6.5 10.6a1.5 1.5 0 0 1 .3-2.97 2.1 2.1 0 0 1 4 .55 1.3 1.3 0 0 1-.3 2.42Z" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
  </svg>;
}

/** An imported whiteboard: a board with sticky notes on it, and an arrow bringing
 *  one across. Deliberately NOT a Miro logo — the glyph names what the panel does
 *  (bring a board over) rather than borrowing another company's mark. */
export function CanvasMiroIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.8" y="2.6" width="7.4" height="10.8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M3.9 5.2h3.2M3.9 7.6h3.2M3.9 10h1.8" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M11 8h3.3m-1.5-1.6L14.4 8l-1.6 1.6" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** Connected social accounts: a share node — one source, several destinations,
 *  which is exactly what the panel behind it does. */
export function CanvasSocialIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="11.6" cy="3.6" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="4.2" cy="8" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <circle cx="11.6" cy="12.4" r="2" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M6 7 9.9 4.7M6 9l3.9 2.3" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>;
}

/** Paid media: rising delivery plus the money that bought it. Deliberately unlike
 *  {@link CanvasSocialIcon}'s share graph — the two sit next to each other on the rail
 *  and "post something" and "spend something" must not look like the same button. */
export function CanvasAdsIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2 13.5h12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    <rect x="3" y="9" width="2.6" height="4.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="6.7" y="6.5" width="2.6" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="10.4" y="3.5" width="2.6" height="10" fill="none" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}
