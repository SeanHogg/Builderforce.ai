'use client';

/**
 * Drag one axis with pointer capture, clamped, with an arrow-key nudge.
 *
 * Extracted from `BrainDock`'s inline width-drag handlers, which is now this
 * hook's first caller alongside the sessions panel's height-drag handle
 * (`SessionList`) — the same "grab an edge, drag, clamp, release" mechanism
 * on two different axes rather than two copies of it.
 */

import { useCallback, useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

export interface UsePointerResizeOptions {
  /** The settled value (px) this drag starts from. */
  value: number;
  /** Fired on every pointer move (settled=false) and once on release/keypress (settled=true). */
  onChange: (next: number, settled: boolean) => void;
  /** Clamp a raw value into range before it is shown or stored. */
  clamp: (value: number) => number;
  /** Keyboard nudge size, in px. */
  step: number;
  /** 'x' drags along clientX (a side-docked width); 'y' along clientY (a stacked height). */
  axis: 'x' | 'y';
  /** Flip which drag/arrow direction grows the value — e.g. a right-docked
   *  panel, where dragging left (a negative delta) is what grows it. */
  invert?: boolean;
}

export interface PointerResizeHandlers {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

export function usePointerResize({ value, onChange, clamp, step, axis, invert = false }: UsePointerResizeOptions): PointerResizeHandlers {
  const drag = useRef<{ pointer: number; value: number } | null>(null);
  const pointerCoord = useCallback((event: PointerEvent) => (axis === 'x' ? event.clientX : event.clientY), [axis]);

  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointer: pointerCoord(event), value };
  }, [pointerCoord, value]);

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const active = drag.current;
    if (!active) return;
    const delta = pointerCoord(event) - active.pointer;
    onChange(clamp(active.value + (invert ? -delta : delta)), false);
  }, [clamp, invert, onChange, pointerCoord]);

  const onPointerUp = useCallback((event: PointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    onChange(value, true);
  }, [onChange, value]);

  const growKey = axis === 'x' ? (invert ? 'ArrowLeft' : 'ArrowRight') : (invert ? 'ArrowUp' : 'ArrowDown');
  const shrinkKey = axis === 'x' ? (invert ? 'ArrowRight' : 'ArrowLeft') : (invert ? 'ArrowDown' : 'ArrowUp');
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const grow = event.key === growKey;
    const shrink = event.key === shrinkKey;
    if (!grow && !shrink) return;
    event.preventDefault();
    onChange(clamp(value + (grow ? step : -step)), true);
  }, [clamp, growKey, onChange, shrinkKey, step, value]);

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown };
}
