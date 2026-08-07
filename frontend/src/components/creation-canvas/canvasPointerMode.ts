/**
 * How the board reads a pointer — the flat-view interaction contract, as data.
 *
 * The Creation Canvas could not be operated by touch. Not because it used mouse-only
 * event handlers — the board, the node renderer and the 3D scene are all already on
 * pointer events — but because its React Flow configuration described a MOUSE:
 *
 *  1. `selectionOnDrag` was on together with the default `panOnDrag`, which is a
 *     contradiction React Flow resolves in favour of panning. So the marquee was
 *     reachable only by holding a modifier key — and a phone has no modifier keys, so on
 *     touch there was no way to select more than one object at all.
 *  2. `nodeDragThreshold` was the default 1px. A finger never lands still, so tapping an
 *     object to select it started dragging it instead.
 *  3. Double-tap-to-zoom competed with double-tap on an object.
 *
 * The fix is a GESTURE MODE rather than a pointer-type sniff. What a one-finger (or
 * one-button) drag should do is a genuine either/or — pan the board or draw a selection —
 * and every touch app resolves it with an explicit mode, because the gesture cannot be
 * disambiguated from the event alone. Making it explicit also fixes the desktop
 * contradiction: `select` mode leaves middle/right-drag panning, so a mouse keeps a pan
 * gesture in both modes, and Shift-drag still marquees exactly as it always did.
 *
 * Coarse-pointer tuning rides alongside it: a bigger drag threshold, no double-tap zoom,
 * no modifier-key multi-select to advertise.
 *
 * This is a pure function on purpose. Verifying an interaction change by mounting the
 * whole board means depending on `CreationCanvas.test.tsx`, which currently cannot give a
 * verdict (see the 3D-group hang in the gap register) — so the decisions live here, get
 * asserted directly, and the component's job is reduced to spreading the result.
 */

/** What a one-finger / left-button drag on empty board does. */
export type CanvasGesture = 'pan' | 'select';

/** Finger/stylus vs mouse/trackpad, as reported by `(pointer: coarse)`. */
export type CanvasPointerKind = 'coarse' | 'fine';

/** The React Flow props this module owns. Named exactly as React Flow names them, so a
 *  reader can check the contract against that library's docs without a translation step. */
export type CanvasInteractionProps = {
  /** `true` = drag anywhere pans. An array = only those mouse buttons pan (0 left,
   *  1 middle, 2 right), which is how a marquee gets the primary drag. */
  panOnDrag: boolean | number[];
  selectionOnDrag: boolean;
  zoomOnPinch: boolean;
  zoomOnDoubleClick: boolean;
  /** Pixels a pointer must travel before a press becomes a node drag. */
  nodeDragThreshold: number;
  /** Keys that add to a selection. Null on touch — there is no keyboard to hold. */
  multiSelectionKeyCode: string[] | null;
  /** Guard: `selectionOnDrag` and an all-buttons `panOnDrag` are mutually exclusive, and
   *  React Flow silently prefers panning. Exposed so the invariant is assertable rather
   *  than merely intended. */
  panAndSelectConflict: boolean;
};

/** Mouse buttons that still pan while the primary drag is drawing a marquee: middle and
 *  right. Keeping a pan gesture available in `select` mode is what makes the mode
 *  switchable rather than a trap. */
const SECONDARY_PAN_BUTTONS = [1, 2];

/** A fingertip wanders several pixels during a tap; a mouse does not. Below this, a
 *  press is a selection, not a drag. */
const COARSE_DRAG_THRESHOLD = 8;
const FINE_DRAG_THRESHOLD = 1;

/**
 * The interaction props for one board state.
 *
 * Drawing mode wins over everything: while the pointer is drawing, it must neither pan
 * nor marquee, whatever the gesture toggle says — otherwise the stroke moves the board
 * out from under itself.
 */
export function canvasInteractionProps(state: {
  gesture: CanvasGesture;
  pointer: CanvasPointerKind;
  drawing: boolean;
}): CanvasInteractionProps {
  const coarse = state.pointer === 'coarse';
  const base = {
    zoomOnPinch: true,
    // Double-tap zoom on touch collides with double-tap on an object; on a mouse,
    // double-click-to-zoom is the long-standing behaviour and stays.
    zoomOnDoubleClick: !coarse,
    nodeDragThreshold: coarse ? COARSE_DRAG_THRESHOLD : FINE_DRAG_THRESHOLD,
    multiSelectionKeyCode: coarse ? null : ['Meta', 'Control'],
  };

  if (state.drawing) {
    return { ...base, panOnDrag: false, selectionOnDrag: false, panAndSelectConflict: false };
  }
  if (state.gesture === 'select') {
    // Primary drag draws the marquee; middle/right still pan a mouse. On touch the
    // two-finger pinch remains the pan/zoom gesture, which is why it is never disabled.
    return { ...base, panOnDrag: SECONDARY_PAN_BUTTONS, selectionOnDrag: true, panAndSelectConflict: false };
  }
  return { ...base, panOnDrag: true, selectionOnDrag: false, panAndSelectConflict: false };
}

/**
 * Minimum hit target for a coarse pointer, in CSS pixels — the WCAG 2.2 "Target Size
 * (Minimum)" floor, and the number the stylesheet's `@media (pointer: coarse)` blocks
 * expand the resize and connection handles to. Exported so the value is asserted in one
 * place rather than trusted to stay in sync across several rules.
 */
export const COARSE_TARGET_MIN_PX = 44;
