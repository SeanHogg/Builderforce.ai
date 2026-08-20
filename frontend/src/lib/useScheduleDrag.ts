import { useCallback, useEffect, useRef, useState } from 'react';
import type { RescheduleMode } from './schedule';

/** A pointer position in client (viewport) coordinates. */
export interface PointerPos {
  x: number;
  y: number;
}

export interface ScheduleDragState<T> {
  item: T;
  mode: RescheduleMode;
  /** Whole days the pointer has travelled since the drag began. May be 0. */
  deltaDays: number;
}

export interface UseScheduleDragOptions<T> {
  /**
   * Whole-day delta between where the drag started and where the pointer is now.
   *
   * A callback rather than a pixels-per-day constant because the two views
   * measure days differently: the Gantt divides horizontal travel by its column
   * width, while the Calendar asks which day CELL is under the pointer — a
   * month grid wraps, so on it a drag can move backwards in x and forwards in
   * time. Both still produce one integer, which is all the rest of this needs.
   */
  deltaFor: (origin: PointerPos, current: PointerPos) => number;
  /** Write the reschedule. Never called with a zero delta. */
  commit: (item: T, mode: RescheduleMode, deltaDays: number) => void;
  /** When false the surface is read-only and `begin` does nothing. */
  enabled?: boolean;
}

/**
 * Pointer-drag → whole-day delta, shared by the Calendar and the Gantt.
 *
 * POINTER EVENTS, NOT HTML5 DRAG-AND-DROP. `draggable` + `dataTransfer` is the
 * shorter route to the same feature and it is the wrong one here: HTML5 DnD does
 * not fire for touch at all, so the schedule would have been editable on a
 * laptop and frozen on the tablet a PM actually reviews a plan on. Pointer
 * events cover mouse, pen and touch with one code path, and `setPointerCapture`
 * keeps the drag alive when the pointer leaves the bar it started on — which it
 * always does, because moving the bar is the entire point.
 *
 * The hook owns only the arithmetic and the lifecycle; each view keeps its own
 * rendering of the in-flight preview, because a ghosted Gantt bar and a ghosted
 * calendar span do not look alike.
 *
 * No `'use client'` of its own: a hook is only ever reachable from a component
 * that already declared one, so the directive would add a file to the client
 * boundary count without moving the boundary.
 */
export function useScheduleDrag<T>({ deltaFor, commit, enabled = true }: UseScheduleDragOptions<T>) {
  const [drag, setDrag] = useState<ScheduleDragState<T> | null>(null);
  // Refs, not state: the pointermove handler must read the ORIGIN and the live
  // delta without re-subscribing on every move (which would drop events).
  const originRef = useRef<PointerPos | null>(null);
  const deltaRef = useRef(0);
  const movedRef = useRef(false);
  const stateRef = useRef<ScheduleDragState<T> | null>(null);
  stateRef.current = drag;

  // Kept in refs so the window listeners installed once below always call the
  // CURRENT callbacks — a parent that re-renders with a new `commit` closure
  // (every render, in practice) must not leave the live drag writing through a
  // stale one.
  const deltaForRef = useRef(deltaFor);
  const commitRef = useRef(commit);
  deltaForRef.current = deltaFor;
  commitRef.current = commit;

  const begin = useCallback((e: React.PointerEvent, item: T, mode: RescheduleMode) => {
    if (!enabled) return;
    // Primary button / touch only — a right-click or a middle-click is not a drag.
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    originRef.current = { x: e.clientX, y: e.clientY };
    deltaRef.current = 0;
    movedRef.current = false;
    setDrag({ item, mode, deltaDays: 0 });
  }, [enabled]);

  useEffect(() => {
    if (!drag) return;

    const onMove = (e: PointerEvent) => {
      const origin = originRef.current;
      if (!origin) return;
      if (Math.abs(e.clientX - origin.x) > 3 || Math.abs(e.clientY - origin.y) > 3) movedRef.current = true;
      const delta = deltaForRef.current(origin, { x: e.clientX, y: e.clientY });
      if (delta === deltaRef.current) return;
      deltaRef.current = delta;
      setDrag((d) => (d ? { ...d, deltaDays: delta } : d));
    };

    const finish = (cancelled: boolean) => {
      const live = stateRef.current;
      const delta = deltaRef.current;
      originRef.current = null;
      deltaRef.current = 0;
      setDrag(null);
      if (!cancelled && live && delta !== 0) commitRef.current(live.item, live.mode, delta);
    };

    const onUp = () => finish(false);
    const onCancel = () => finish(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') finish(true); };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKey);
    };
  }, [drag]);

  /**
   * True when the gesture that just ended actually MOVED. Views call this from
   * their click handler: a bar is both a drag handle and a link to the item, and
   * without this every reschedule would also open the thing it just moved.
   */
  const consumedClick = useCallback(() => {
    if (!movedRef.current) return false;
    movedRef.current = false;
    return true;
  }, []);

  return { drag, begin, consumedClick };
}

/** The day cell under a viewport point, as the `YYYY-MM-DD` its element declares. */
export function dayKeyAtPoint(pos: PointerPos): string | null {
  if (typeof document === 'undefined') return null;
  const el = document.elementFromPoint(pos.x, pos.y);
  const cell = el?.closest?.('[data-schedule-day]') as HTMLElement | null | undefined;
  return cell?.dataset.scheduleDay ?? null;
}
