// No 'use client' directive: this hook is only ever imported from `CreationCanvas.tsx`
// and `CanvasCommandBar.tsx`, both already inside that client boundary — see the same
// reasoning in `useChromeSpace.ts` and `CanvasCommandBar.tsx`'s own header.
import { useCallback, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';

export interface PanelDragOffset { x: number; y: number; }

const STORAGE_PREFIX = 'builderforce:create:panelOffset:';
const KEY_NUDGE_PX = 16;
const ZERO: PanelDragOffset = { x: 0, y: 0 };

function readOffset(panelId: string): PanelDragOffset {
  if (typeof window === 'undefined') return ZERO;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + panelId);
    if (!raw) return ZERO;
    const parsed = JSON.parse(raw) as Partial<PanelDragOffset>;
    return typeof parsed.x === 'number' && typeof parsed.y === 'number' ? { x: parsed.x, y: parsed.y } : ZERO;
  } catch {
    return ZERO;
  }
}

function writeOffset(panelId: string, offset: PanelDragOffset): void {
  if (typeof window === 'undefined') return;
  try {
    if (offset.x === 0 && offset.y === 0) window.localStorage.removeItem(STORAGE_PREFIX + panelId);
    else window.localStorage.setItem(STORAGE_PREFIX + panelId, JSON.stringify(offset));
  } catch {
    // Storage can be unavailable in hardened contexts. Best-effort persistence;
    // the offset just resets next session instead of failing the drag.
    return;
  }
}

interface DragSession {
  pointerId: number;
  startX: number;
  startY: number;
  origin: PanelDragOffset;
  /** The card's own top/left with the CURRENT offset backed out — its CSS-computed
   *  position, so a drag started mid-offset still measures from the true origin. */
  baseLeft: number;
  baseTop: number;
  width: number;
  height: number;
  parentLeft: number;
  parentTop: number;
  parentRight: number;
  parentBottom: number;
}

function clampToParent(raw: PanelDragOffset, session: DragSession): PanelDragOffset {
  const minX = session.parentLeft - session.baseLeft;
  const maxX = session.parentRight - session.width - session.baseLeft;
  const minY = session.parentTop - session.baseTop;
  const maxY = session.parentBottom - session.height - session.baseTop;
  // `min`/`max` swap when the card is wider or taller than its parent has room for —
  // clamping straight to [minX, maxX] would then force a raw value into an empty range.
  return {
    x: Math.min(Math.max(raw.x, Math.min(minX, maxX)), Math.max(minX, maxX)),
    y: Math.min(Math.max(raw.y, Math.min(minY, maxY)), Math.max(minY, maxY)),
  };
}

/**
 * Lets one piece of floating chrome be dragged off the position its own CSS computes, by
 * a handle it renders itself (`PanelDragHandle`).
 *
 * The offset is applied through the standalone `translate` CSS property rather than
 * `transform`, so a card centred with `transform:translateX(-50%)` — the command bar, the
 * surface chips — keeps that centring as its baseline and a drag only ever moves it FROM
 * there; the two properties compose instead of one overwriting the other.
 *
 * Remembered per browser and per panel, the same way the prompt's own float/dock/closed
 * placement is (`canvasPromptPlacement.ts`) — a person who dragged a card out of the way
 * of their board does not want it snapping back on reload. Clamped to the card's own
 * containing block (`.canvasShell`, the floating chrome's shared positioning root) so a
 * drag can never leave the card off-screen with no way to reach its handle again.
 */
export function usePanelDragOffset(panelId: string) {
  const [offset, setOffset] = useState<PanelDragOffset>(() => readOffset(panelId));
  const elementRef = useRef<HTMLElement | null>(null);
  const session = useRef<DragSession | null>(null);

  const startDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const el = elementRef.current;
    const parent = el?.offsetParent as HTMLElement | null;
    if (!el || !parent || event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const elRect = el.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    session.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: offset,
      baseLeft: elRect.left - offset.x,
      baseTop: elRect.top - offset.y,
      width: elRect.width,
      height: elRect.height,
      parentLeft: parentRect.left,
      parentTop: parentRect.top,
      parentRight: parentRect.right,
      parentBottom: parentRect.bottom,
    };
  }, [offset]);

  const moveDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const active = session.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const raw = { x: active.origin.x + (event.clientX - active.startX), y: active.origin.y + (event.clientY - active.startY) };
    setOffset(clampToParent(raw, active));
  }, []);

  const endDrag = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const active = session.current;
    if (!active || event.pointerId !== active.pointerId) return;
    session.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    setOffset((current) => {
      writeOffset(panelId, current);
      return current;
    });
  }, [panelId]);

  const nudge = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    const deltas: Partial<Record<string, PanelDragOffset>> = {
      ArrowLeft: { x: -KEY_NUDGE_PX, y: 0 },
      ArrowRight: { x: KEY_NUDGE_PX, y: 0 },
      ArrowUp: { x: 0, y: -KEY_NUDGE_PX },
      ArrowDown: { x: 0, y: KEY_NUDGE_PX },
    };
    const delta = deltas[event.key];
    if (!delta) return;
    event.preventDefault();
    setOffset((current) => {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      writeOffset(panelId, next);
      return next;
    });
  }, [panelId]);

  const reset = useCallback(() => {
    setOffset(ZERO);
    writeOffset(panelId, ZERO);
  }, [panelId]);

  const isMoved = offset.x !== 0 || offset.y !== 0;
  const style: CSSProperties | undefined = isMoved ? ({ translate: `${offset.x}px ${offset.y}px` } as CSSProperties) : undefined;

  return {
    elementRef,
    style,
    isMoved,
    handleProps: {
      onPointerDown: startDrag,
      onPointerMove: moveDrag,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onKeyDown: nudge,
      onDoubleClick: reset,
    },
  };
}
