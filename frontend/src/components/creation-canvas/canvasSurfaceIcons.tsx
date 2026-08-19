/*
 * No `'use client'` here on purpose. Imported only by components that already declare
 * the boundary, so a directive would mark a second entry point that does not exist.
 */
import {
  AppSurfaceIcon,
  ChatSurfaceIcon,
  GraphSurfaceIcon,
  ThreeDIcon,
} from '@/components/canvas/CanvasCommands';
import type { CanvasSurfaceId } from '@/lib/canvasSurfaces';

/**
 * The glyph for a surface — ONE map, for every surface, read by everything that draws one.
 *
 * ── WHY THIS MOVED OUT OF THE SWITCHER ───────────────────────────────────────────
 * The switcher owned a private map keyed by surface id, and it covered the three BOARD
 * surfaces because that is all a rail offers. Then a second consumer appeared:
 * `CanvasObjectSurfaceButton`, which opens an OBJECT surface from the object panel header —
 * a row of 25×25 icon slots. Having no glyph for `page`, `play`, `site` or `timeline`, it
 * rendered its LABEL instead, and "Open the site" in a 25px box overflowed across the
 * panel title, the close button and the tab strip beneath it. A worded control in an icon
 * slot is not a styling accident; it is what happens when the icon table only covers half
 * the registry and the other half has to improvise.
 *
 * So the map is complete and it lives beside neither consumer. It stays a COMPONENT map
 * rather than moving into `lib/canvasSurfaces.ts` on purpose: that registry is spec data
 * with no React in it, and putting JSX there would invert the dependency the whole seam
 * is built on.
 *
 * ── WHY THE FALLBACK STAYS ───────────────────────────────────────────────────────
 * A surface added to the registry without a glyph must degrade, not throw: the lookup
 * used to be read straight into `<Glyph />`, so following the registry's own documented
 * steps crashed the session bar. It now draws the first letter of the surface's name,
 * which is legible, pressable and obviously unfinished — the three things a crash is not.
 */
const SURFACE_ICON: Partial<Record<CanvasSurfaceId, () => React.JSX.Element>> = {
  chat: ChatSurfaceIcon,
  graph: GraphSurfaceIcon,
  scene3d: ThreeDIcon,
  app: AppSurfaceIcon,
  page: PageSurfaceIcon,
  play: PlaySurfaceIcon,
  site: SiteSurfaceIcon,
  timeline: TimelineSurfaceIcon,
};

/** A sheet with a line of text on it — the page runtime's own axis is the measure. */
export function PageSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3.4 1.9h6L12.8 5v9.1H3.4z" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    <path d="M9.2 2.1v3.2h3.4" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    <path d="M5.6 8.4h5M5.6 11h3.4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>;
}

/** A running build: a play mark, unframed — the frame is what `app` uses. */
export function PlaySurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.1" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M6.5 5.4v5.2l4.2-2.6z" fill="currentColor" />
  </svg>;
}

/** Pages you move between, at a width you pick — a browser frame with a nav row. */
export function SiteSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.7" y="3" width="12.6" height="10" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.25" />
    <path d="M1.7 6h12.6" stroke="currentColor" strokeWidth="1.1" />
    <path d="M4.4 8.6h4.2M4.4 10.7h6.2" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>;
}

/** Time, as tracks — two rows of clip, which is the axis a card cannot draw. */
export function TimelineSurfaceIcon() {
  return <svg viewBox="0 0 16 16" aria-hidden="true">
    <rect x="1.7" y="4" width="7.4" height="3.2" rx=".9" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <rect x="5" y="8.8" width="9.3" height="3.2" rx=".9" fill="none" stroke="currentColor" strokeWidth="1.2" />
    <path d="M1.7 2v12" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>;
}

/**
 * The glyph for this surface, or its initial when the registry has grown past this map.
 *
 * `label` is the surface's translated name, so the fallback reads as an abbreviation of
 * the thing it stands for rather than as the raw id.
 */
export function canvasSurfaceGlyph(id: CanvasSurfaceId, label: string): React.JSX.Element {
  const Glyph = SURFACE_ICON[id];
  return Glyph ? <Glyph /> : <span aria-hidden>{label.slice(0, 1)}</span>;
}
