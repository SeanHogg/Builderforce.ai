/**
 * What a COLLAPSED canvas session bar still shows.
 *
 * ── THE RULE, IN ONE PLACE ───────────────────────────────────────────────────────
 * **Collapse hides controls, never status.**
 *
 * A canvas fills the screen and the bar above it does not change for minutes at a time,
 * so being able to fold it away is worth having. What made that dangerous is the thing
 * the bar reports rather than the things it does: fold away "who is in this session",
 * "is the connection live" and "is a run happening", and the operator is now working
 * blind on a board other people are editing. A collapsed team is a team nobody can see
 * is working.
 *
 * So each slot in the bar declares which of the two it IS, and the single predicate
 * below answers whether it survives. Every consumer — the header, the phone sheet, the
 * surface that contributes its own controls — asks the same question of the same table,
 * which is what stops "the roster stays" being true in one place and forgotten in the
 * next. Adding a slot is a row here; it never becomes an `if (collapsed && slot !== …)`
 * at a call site.
 *
 * ── WHY NOT JUST HIDE THE ACTIONS ────────────────────────────────────────────────
 * Because "the actions" is not the boundary. The surface switcher is a control and the
 * save state is not, and they sit two elements apart in the same row. And a runtime that
 * contributes to the bar contributes BOTH: an app surface's Run button is a control and
 * the address it is running at is status, so the seam has to carry the distinction too
 * rather than treating a whole contribution as one or the other.
 */

/**
 * The addressable parts of the session bar.
 *
 * Named for what they SAY, not for the component that draws them — `roster` is "who is
 * here", whichever of the three roster shapes the session happens to be in.
 */
export type CanvasChromeSlot =
  /** The last outcome worth reporting, plus the realtime connection state. */
  | 'saveState'
  /** Who is in this session right now, and who is typing. */
  | 'roster'
  /** Chat / Board / 3D space / App. */
  | 'surfaces'
  /** Undo, redo, outcomes, diagnostics, full screen — the glyphs that act on the board. */
  | 'actions'
  /**
   * Share and Publish — the two ways work LEAVES this canvas.
   *
   * A separate slot from `actions` because they are a separate PLACE, and the reason is
   * the same one that makes them the only worded actions in the registry: a glyph acts on
   * the board and a word opens somewhere else. Grouping "undo" with "publish to a public
   * URL" put a keystroke you take back beside a decision you cannot, at the same weight.
   */
  | 'handoff'
  /** A runtime's own controls — an app surface's Run/Stop and its readings. */
  | 'surfaceControls'
  /** A runtime's own report — where it is running, and whether it is. */
  | 'surfaceStatus';

export type CanvasChromeKind = 'status' | 'control';

/**
 * WHERE a slot is drawn, now that the canvas has no chrome band at all.
 *
 * ── WHY PLACEMENT IS DATA ────────────────────────────────────────────────────────
 * The canvas used to spend four horizontal bands on chrome — marketing header, session
 * bar, team bar, board rail — before a single object was drawn, and the board got
 * whatever was left. The shell now gives the WHOLE window to the canvas and floats each
 * piece of chrome over it, which is the arrangement every scenario editor worth copying
 * converged on for the same reason: the artefact is the thing, and the controls are
 * guests on it.
 *
 * The trap in that move is that "float it" is a per-element decision, so it decays into
 * four components each holding its own `position:absolute` and its own idea of which
 * corner is free. Placement is therefore declared HERE, beside the collapse rule, for the
 * same reason the collapse rule is here: one table answers both "is this on screen" and
 * "where", and a slot added later cannot be given a home by accident.
 *
 *   `pill`     — top left. Is the work somewhere safe: saved, and its connection state.
 *   `chips`    — top centre. How it is being READ. Non-blocking, on the canvas.
 *   `topRight` — top right. How work LEAVES it: Share, Publish, and the overflow.
 *   `bar`      — bottom centre. What you DO to it, including whatever the surface
 *                itself contributes.
 */
export type CanvasChromePlace = 'pill' | 'chips' | 'topRight' | 'bar';

/**
 * Which each slot is. The whole rule is this table plus the predicate under it.
 *
 * There is no `save` slot, and its absence is a decision rather than an omission. A board
 * held only on this device is kept by taking an account, and the header already makes
 * exactly that offer — the green CTA turns into "Keep your work" the moment this browser
 * holds a local board. A second button on the canvas saying the same word put two bars on
 * one screen competing to be the way to save, and ambient "Saved on this device" chatter
 * sitting in the pill at rest was the same collision one notch quieter — the header CTA
 * already says it. `saveState` in the pill now carries only what is not said anywhere
 * else: the last outcome, until it has nothing left to add.
 */
const SLOT_KIND: Readonly<Record<CanvasChromeSlot, CanvasChromeKind>> = {
  saveState: 'status',
  roster: 'status',
  surfaceStatus: 'status',
  surfaces: 'control',
  actions: 'control',
  handoff: 'control',
  surfaceControls: 'control',
};

/**
 * Where each slot floats.
 *
 * `roster` is in the BAR and not in the pill, which is the one placement worth arguing
 * about. Who is here is status, so it survives a collapse — and the collapsed bar is the
 * thing left on screen, so that is where the avatars have to be for the rule to mean
 * anything. Putting them in the pill would have kept them visible while making the
 * collapse rule a statement about an element that never folds.
 */
const SLOT_PLACE: Readonly<Record<CanvasChromeSlot, CanvasChromePlace>> = {
  saveState: 'pill',
  roster: 'bar',
  surfaces: 'chips',
  actions: 'bar',
  handoff: 'topRight',
  surfaceControls: 'bar',
  surfaceStatus: 'bar',
};

export function canvasChromeKind(slot: CanvasChromeSlot): CanvasChromeKind {
  return SLOT_KIND[slot];
}

export function canvasChromePlace(slot: CanvasChromeSlot): CanvasChromePlace {
  return SLOT_PLACE[slot];
}

/** Every slot that floats in one region, in declaration order. */
export function canvasChromeSlotsIn(place: CanvasChromePlace): readonly CanvasChromeSlot[] {
  return (Object.keys(SLOT_PLACE) as CanvasChromeSlot[]).filter((slot) => SLOT_PLACE[slot] === place);
}

/**
 * Whether this slot is on screen. The ONE question every consumer asks — so a slot that
 * survives a collapse survives it in the header, in the phone sheet and in whatever a
 * surface contributed, without any of them holding a copy of the rule.
 */
export function canvasChromeShows(slot: CanvasChromeSlot, collapsed: boolean): boolean {
  return !collapsed || SLOT_KIND[slot] === 'status';
}

/** Every slot that survives a collapse. Exported for the test that reads the rule back,
 *  and for anything that needs to describe the collapsed bar rather than draw it. */
export function canvasChromeStatusSlots(): readonly CanvasChromeSlot[] {
  return (Object.keys(SLOT_KIND) as CanvasChromeSlot[]).filter((slot) => SLOT_KIND[slot] === 'status');
}

export const CANVAS_BAR_COLLAPSED_KEY = 'builderforce:create:barCollapsed';

/**
 * Whether the bar was folded away last time. Persisted for the same reason a surface is:
 * it is a place the operator chose to work, and re-expanding a bar on every reload is
 * the app overruling a decision they already made.
 *
 * Defaults to expanded — a first-time visitor must not meet a canvas whose controls are
 * hidden behind a chevron they have never seen.
 */
export function readCanvasBarCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(CANVAS_BAR_COLLAPSED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeCanvasBarCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CANVAS_BAR_COLLAPSED_KEY, String(collapsed));
  } catch { /* storage can be unavailable in hardened contexts */ }
}
