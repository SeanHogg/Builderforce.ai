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
   * Publish — the door work LEAVES this canvas through, and the ••• overflow beside it.
   *
   * A separate slot from `actions`, though the same PLACE now (`bar`) — grouping "undo"
   * with "publish to a public URL" put a keystroke you take back beside a decision you
   * cannot, at the same weight — so it stays a slot apart, drawn behind its own divider,
   * rather than folded into `actions` just because they now share a region with it.
   *
   * Share used to be the other worded action here. It draws as the roster's own
   * trailing chip now (`chrome: 'roster'` in `canvasSessionActions.ts`) — folding with
   * `actions` rather than `handoff` when the bar collapses, since it is gated the same
   * way the glyphs beside the roster are, not by this slot.
   */
  | 'handoff'
  /** A runtime's own controls — an app surface's Run/Stop and its readings. */
  | 'surfaceControls'
  /** A runtime's own report — where it is running, and whether it is. */
  | 'surfaceStatus';

export type CanvasChromeKind = 'status' | 'control';

/**
 * ── WHERE A SLOT IS DRAWN IS NO LONGER THIS FILE'S QUESTION ──────────────────────
 * It used to be: a `CanvasChromePlace` union (`pill` | `chips` | `bar`), a `SLOT_PLACE`
 * table, and `canvasChromeSlotsIn(place)` which the command bar iterated so that "the
 * sequence the bar shows" was stated once rather than read off a column of JSX.
 *
 * The bar has no linear slot order any more. Its groups are the ARC — Idea, Make, Run,
 * Measure, Reach, then the board — and that order belongs to `CANVAS_BAR_GROUP_ORDER` in
 * `lib/canvasBarGroups.ts`, which is where the five words already live. The roster and
 * the doors out are contributions INTO those groups now rather than regions beside them,
 * so a second table naming a region for each was describing a layout that had stopped
 * existing. It was deleted rather than left to drift, which is the state a placement
 * table nobody reads always ends in.
 *
 * What is left here is the ONE question every consumer still asks and none of them may
 * answer privately: does this survive a collapse.
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
 * Whether this slot is on screen. The ONE question every consumer asks — so a slot that
 * survives a collapse survives it in the header, in the phone sheet and in whatever a
 * surface contributed, without any of them holding a copy of the rule.
 */
export function canvasChromeShows(slot: CanvasChromeSlot, collapsed: boolean): boolean {
  return !collapsed || SLOT_KIND[slot] === 'status';
}

const CANVAS_BAR_COLLAPSED_KEY = 'builderforce:create:barCollapsed';

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
