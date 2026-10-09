/**
 * Canvas LENSES — which way the ONE canvas is presented, as data.
 *
 * ── WHY A LENS AND NOT A SECOND RUNTIME ──────────────────────────────────────────
 * Studio (`/studio/<sessionId>`) and the canvas (`/create/<sessionId>`) are the SAME
 * board: the same session id, the same mounted `CreationCanvas` instance on the shell's
 * stage (`CanvasStage` keys by `persistence:sessionId`), the same App surface over the
 * same session app. What differs is only what is DRAWN around it — Studio is prompt +
 * preview, the way Lovable and Replit read, with no operator sidebar, no phase/surface
 * chrome and no session command bar. So switching between the two is a route change
 * with the board kept, which is the back-and-forth the operator asked to keep.
 *
 * Every decision a lens makes lives in its row below. Nothing downstream branches on
 * `lens === 'studio'`; it reads {@link canvasLensDefinition} and asks the field it
 * needs — so a third lens is one row, not a hunt for string comparisons.
 *
 * Import-light on purpose (type-only imports, plus the import-free `studioHost`):
 * `lensForRoute` is read by the shell's routing policy, which must not drag the canvas
 * in behind it.
 *
 * No 'use client' directive: a plain module, imported from client boundaries.
 */
import type { CanvasSurfaceId } from './canvasSurfaces';
import type { ProjectModality } from './modality';
import type { CanvasPhase } from './canvasPhases';
import type { CanvasPromptPlacement } from './canvasPromptPlacement';
import { studioSessionPath } from './studio/studioHost';

export type CanvasLens = 'canvas' | 'studio';

/** An edge of the board. Spelled here rather than imported from the canvas's dock module:
 *  `lib/` does not reach into `components/` (it matches `BrainDockSide` structurally). */
export type CanvasLensDockSide = 'left' | 'right';

export interface CanvasLensDef {
  id: CanvasLens;
  /**
   * Which chrome is drawn. `topChrome` and `commandBar` are the canvas's own; the
   * `shell*` flags are read by the APP shell (`AppShell`), not the canvas — the operator
   * rail (and the top bar's button that opens it), the phone's bottom nav and the team
   * footer. A lens that reads as prompt + preview draws none of them.
   */
  chrome: { topChrome: boolean; commandBar: boolean; shellSidebar: boolean; shellMobileNav: boolean; shellTeamBar: boolean };
  /** The surface the lens opens on, applied when the lens is entered. Null = leave as is. */
  surface: CanvasSurfaceId | null;
  /**
   * The lens's surface is HOME, not a place it visits: Escape from it does not hand the
   * board back, a surface that leaves it (a revealed card, a room) is a detour, and the
   * lens's own bar offers the way back. Without this a lens that draws no surface
   * switcher strands the reader on a bare board one keypress away from its app.
   */
  holdsSurface: boolean;
  /** The app the lens expects. Entering a board with no app and no code cards creates one of this modality. */
  appModality: ProjectModality | null;
  /** Lowest phase the lens needs offered (so its surface has a tab). */
  phaseFloor: CanvasPhase | null;
  /** Brain dock applied on entry — a presentation, never written to the person's stored preference. */
  brainDock: { side: CanvasLensDockSide; open: true } | null;
  /** Composer placement forced while the lens is active (wins over the stored preference while the dock is drawn). */
  promptPlacement: CanvasPromptPlacement | null;
  /** The canvas's own tours (the chrome walkthrough, the board walkthrough). A lens that does
   *  not draw the chrome they point at must not offer them — nor spend the first-visit offer. */
  tours: boolean;
  /** The lens the App surface's bar links across to ("Open in Studio"), or null when this
   *  lens's own bar already carries the way across. */
  appSurfaceLink: CanvasLens | null;
}

export const CANVAS_LENSES: readonly CanvasLensDef[] = [
  { id: 'canvas', chrome: { topChrome: true, commandBar: true, shellSidebar: true, shellMobileNav: true, shellTeamBar: true }, surface: null, holdsSurface: false, appModality: null, phaseFloor: null, brainDock: null, promptPlacement: null, tours: true, appSurfaceLink: 'studio' },
  { id: 'studio', chrome: { topChrome: false, commandBar: false, shellSidebar: false, shellMobileNav: false, shellTeamBar: false }, surface: 'app', holdsSurface: true, appModality: 'designer', phaseFloor: 'make', brainDock: { side: 'left', open: true }, promptPlacement: 'docked', tours: false, appSurfaceLink: null },
];

export const DEFAULT_CANVAS_LENS: CanvasLens = 'canvas';

const BY_ID = new Map<CanvasLens, CanvasLensDef>(CANVAS_LENSES.map((def) => [def.id, def]));

export function isCanvasLens(value: unknown): value is CanvasLens {
  return typeof value === 'string' && BY_ID.has(value as CanvasLens);
}

/** The lens's rules. Falls back to the canvas lens rather than throwing, like `canvasSurfaceDefinition`. */
export function canvasLensDefinition(id: CanvasLens): CanvasLensDef {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_CANVAS_LENS)!;
}

/**
 * The Studio lens's sessions: `/studio/<sessionId>`, but NOT `/studio/project/<id>` —
 * that is the durable-project Studio IDE, a different page with its own chrome — and not
 * the bare `/studio` home, which is a public page.
 */
const STUDIO_LENS_ROUTE = /^\/studio\/(?!project(?:\/|$))[^/]+\/?$/;
/** A board opened on the canvas: `/create/<sessionId>` (and the creation entries under it). */
const CANVAS_LENS_ROUTE = /^\/create\/[^/]+/;

/**
 * Which lens THIS route presents its board through, or null when the route puts no
 * creation board on the stage. ONE function, read by the shell's stage policy
 * (`workbenchPolicy.isStageRoute`) and by `AppShell` for the sidebar — so "is this a
 * board" and "how is it presented" can never be answered from two lists.
 */
export function lensForRoute(pathname: string): CanvasLens | null {
  if (STUDIO_LENS_ROUTE.test(pathname)) return 'studio';
  if (CANVAS_LENS_ROUTE.test(pathname)) return 'canvas';
  return null;
}

/** The surface a lens keeps the reader on, or null when it keeps none (`holdsSurface`). */
export function canvasLensHome(def: CanvasLensDef): CanvasSurfaceId | null {
  return def.holdsSurface ? def.surface : null;
}

/** Where each lens addresses a session — one row per lens, beside the registry. */
const LENS_SESSION_PATHS: Readonly<Record<CanvasLens, (sessionId: string) => string>> = {
  canvas: (sessionId) => `/create/${encodeURIComponent(sessionId)}`,
  studio: studioSessionPath,
};

/**
 * The URL of a session seen through a lens — where a redirect that must KEEP the lens
 * goes (claiming a guest draft swaps its `local-…` id for the server id, and the person
 * must stay in Studio if that is where they were). `query` entries with an empty value
 * are dropped.
 */
export function canvasLensSessionPath(lens: CanvasLens, sessionId: string, query?: Readonly<Record<string, string | null | undefined>>): string {
  const path = LENS_SESSION_PATHS[lens](sessionId);
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value) search.set(key, value);
  const tail = search.toString();
  return tail ? `${path}?${tail}` : path;
}

/**
 * The chrome the lens THIS route presents its board through asks for, or null when the
 * route puts no board on the stage. What the app shell reads to decide its own pieces —
 * the rail, the phone's bottom nav, the team footer — so it never compares lens ids.
 */
export function lensChromeForRoute(pathname: string): CanvasLensDef['chrome'] | null {
  const lens = lensForRoute(pathname);
  return lens ? canvasLensDefinition(lens).chrome : null;
}
