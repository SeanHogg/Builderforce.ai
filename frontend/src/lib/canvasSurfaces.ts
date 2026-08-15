/**
 * Canvas surfaces — which RUNTIME the creation canvas mounts in its centre.
 *
 * ── THE AXIS THIS ADDS ───────────────────────────────────────────────────────────
 * The canvas already had one first-class extensibility hook: the object KIND, declared
 * once as spec data (`specObjects.ts`) so a new kind is an entry, never a render branch.
 * That axis answers "what is this thing?". It never answered "how is this board read?",
 * and the board only ever had one answer — a node graph — with 3D bolted on as a boolean
 * beside it.
 *
 * A node graph is the right metaphor for an idea, a system or a plan. It is the WRONG
 * metaphor for a conversation, and it will be the wrong metaphor for a podcast (time is
 * the axis), a resume (a page is the axis) or a playable build. Those need a different
 * centre, not a different node.
 *
 * So `CanvasSurfaceId` is the second axis, and it is spec DATA for the same reason kinds
 * are: adding one is an entry here plus a ReactNode handed to `CanvasSurfaceRouter`. The
 * host never learns a surface's name, and no consumer re-derives "does this surface have
 * a board?" from an id comparison — it reads the flag.
 *
 * ── WHY THE 3D BOOLEAN MOVED IN HERE ─────────────────────────────────────────────
 * `useCanvasThreeD` keeps a flat-or-3D boolean for the four OTHER spatial canvases, and
 * still does. On the creation canvas that boolean was a second answer to the question
 * this registry now owns: two states, two controls, and a `threeD.active ? '3d' : 'flat'`
 * ternary that a third surface could not extend. The creation canvas therefore derives
 * 3D from the surface instead of holding its own copy — one state, one control on the
 * rail, one `data-view` attribute the stylesheet keys on.
 *
 * ── ADDING A SURFACE ─────────────────────────────────────────────────────────────
 *   1. an entry in `CANVAS_SURFACES` below,
 *   2. `creationCanvas.surface.<id>.{label,enter,active}` in ALL FIVE catalogs,
 *   3. the ReactNode in the host's `surfaces` map (see `CanvasSurfaceRouter`).
 * Nothing else branches: the rail, the stylesheet, the Brain placement and the stored
 * preference all read the flags.
 */

export type CanvasSurfaceId = 'chat' | 'graph' | 'scene3d';

export interface CanvasSurfaceDef {
  id: CanvasSurfaceId;
  /** Order on the command rail and the phone-sized action stack. */
  order: number;
  /**
   * Whether the flat React Flow board is what the user is reading. False means a
   * surface has taken the centre over, which is what the stylesheet suppresses the
   * viewport, the palette and the remote cursors from — and what hides the
   * pan-vs-marquee choice, since there is no flat pane left to make it about.
   */
  showsBoard: boolean;
  /**
   * Whether Brain IS this surface rather than a panel beside it. The canvas allows
   * exactly ONE live transcript on screen, so a surface that renders the conversation
   * itself is also what suppresses the edge dock and its launcher — the consumer reads
   * this instead of asking `surface === 'chat'` in three places.
   */
  brainIsSurface: boolean;
  /**
   * Whether the choice survives a reload. A surface is a place the user chose to work
   * (`chat` is a front door, not a mode); a PROJECTION of the board they were already
   * on is not — coming back to a canvas silently rotated into 3D reads as a bug, so
   * `scene3d` is entered deliberately every time.
   */
  persist: boolean;
}

/** Declaration order is display order; `order` is what consumers sort on. */
export const CANVAS_SURFACES: readonly CanvasSurfaceDef[] = [
  // Chat first: it is the zero-object case of the canvas and the surface a visitor
  // arriving from any other assistant already knows how to use.
  { id: 'chat', order: 0, showsBoard: false, brainIsSurface: true, persist: true },
  { id: 'graph', order: 1, showsBoard: true, brainIsSurface: false, persist: true },
  { id: 'scene3d', order: 2, showsBoard: false, brainIsSurface: false, persist: false },
];

export const DEFAULT_CANVAS_SURFACE: CanvasSurfaceId = 'graph';

const BY_ID = new Map<CanvasSurfaceId, CanvasSurfaceDef>(CANVAS_SURFACES.map((def) => [def.id, def]));

/** The surface's rules. Falls back to the default rather than throwing, so a stale
 *  stored id or a stray query param degrades to the board instead of a blank page. */
export function canvasSurfaceDefinition(id: CanvasSurfaceId): CanvasSurfaceDef {
  return BY_ID.get(id) ?? BY_ID.get(DEFAULT_CANVAS_SURFACE)!;
}

export function isCanvasSurfaceId(value: unknown): value is CanvasSurfaceId {
  return typeof value === 'string' && BY_ID.has(value as CanvasSurfaceId);
}

export function sanitizeCanvasSurface(value: unknown): CanvasSurfaceId {
  return isCanvasSurfaceId(value) ? value : DEFAULT_CANVAS_SURFACE;
}

export const CANVAS_SURFACE_STORAGE_KEY = 'builderforce:create:surface';

/**
 * The surface a returning visitor lands on. A non-persisting surface was a reading of
 * the board rather than a place, so it resolves back to the board — the rule lives in
 * the registry, not in a `=== 'scene3d'` check at the call site.
 */
export function readCanvasSurface(): CanvasSurfaceId {
  if (typeof window === 'undefined') return DEFAULT_CANVAS_SURFACE;
  try {
    const stored = sanitizeCanvasSurface(window.localStorage.getItem(CANVAS_SURFACE_STORAGE_KEY));
    return canvasSurfaceDefinition(stored).persist ? stored : DEFAULT_CANVAS_SURFACE;
  } catch {
    return DEFAULT_CANVAS_SURFACE;
  }
}

export function writeCanvasSurface(id: CanvasSurfaceId): void {
  if (typeof window === 'undefined') return;
  try {
    // A projection is never written, so leaving 3D cannot resurrect a surface the user
    // has since moved on from — the last PLACE they chose is what is remembered.
    if (!canvasSurfaceDefinition(id).persist) return;
    window.localStorage.setItem(CANVAS_SURFACE_STORAGE_KEY, id);
  } catch { /* storage can be unavailable in hardened contexts */ }
}
