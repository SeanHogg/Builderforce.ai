import { useEffect, type RefObject } from 'react';
import { addLook, adjustZoom } from './walkerInput';

/** Radians of turn per CSS pixel of drag. */
const LOOK_RATE = 0.0045;
/** Metres of third-person distance per wheel notch (100 px). */
const ZOOM_RATE = 0.01;

export interface DragLookOptions {
  /**
   * Which pointers turn the camera. `touch` is a finger only — right for a
   * surface whose mouse is pointer-locked. `touchAndSecondary` adds the right
   * mouse button and the wheel: Roblox's scheme, for the room, where the left
   * button must stay free for the room's own buttons and drags.
   */
  buttons: 'touch' | 'touchAndSecondary';
  enabled: boolean;
}

/**
 * Turn a drag on `ref`'s element into look input for the walker.
 *
 * ── WHY IT IS A HOOK ON THE VIEWPORT, NOT A CONTROL IN THE SCENE ─────────────
 * Three.js pointer events reach a mesh only when the ray hits one; a finger
 * dragged across empty sky would turn nothing. The DOM element under the canvas
 * sees every pointer, so that is where a look gesture is read. It writes to the
 * one input the walker already reads (`walkerInput.ts`), so the controller does
 * not know or care whether a mouse, a finger or a pad turned it.
 *
 * The right-button drag suppresses the context menu for as long as it is on, and
 * only then — a right-click on the roster beside the room is still a right-click.
 */
export function useDragLook(ref: RefObject<HTMLElement | null>, { buttons, enabled }: DragLookOptions): void {
  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;
    let active: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const accepts = (event: PointerEvent) => event.pointerType === 'touch'
      || (buttons === 'touchAndSecondary' && event.pointerType === 'mouse' && event.button === 2);

    const down = (event: PointerEvent) => {
      if (active !== null || !accepts(event)) return;
      active = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      element.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== active) return;
      addLook((event.clientX - lastX) * LOOK_RATE, (event.clientY - lastY) * LOOK_RATE);
      lastX = event.clientX;
      lastY = event.clientY;
      event.preventDefault();
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== active) return;
      active = null;
      element.releasePointerCapture?.(event.pointerId);
    };
    const contextMenu = (event: Event) => { if (buttons === 'touchAndSecondary') event.preventDefault(); };
    const wheel = (event: WheelEvent) => {
      if (buttons !== 'touchAndSecondary') return;
      event.preventDefault();
      adjustZoom(event.deltaY * ZOOM_RATE);
    };

    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move, { passive: false });
    element.addEventListener('pointerup', up);
    element.addEventListener('pointercancel', up);
    element.addEventListener('contextmenu', contextMenu);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', up);
      element.removeEventListener('pointercancel', up);
      element.removeEventListener('contextmenu', contextMenu);
      element.removeEventListener('wheel', wheel);
    };
  }, [ref, buttons, enabled]);
}
