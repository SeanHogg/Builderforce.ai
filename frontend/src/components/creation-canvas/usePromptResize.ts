import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

export const MIN_PROMPT_HEIGHT = 34;
export const MAX_PROMPT_HEIGHT = 240;

const clamp = (value: number) => Math.min(MAX_PROMPT_HEIGHT, Math.max(MIN_PROMPT_HEIGHT, value));

/**
 * How tall the reader has pulled the canvas prompt, and the grip that pulls it.
 *
 * Local to the composer card because nothing outside it has ever read the number — it
 * lived in `CreationCanvas` only while the markup did. The shared composer has no grip of
 * its own; this is chrome of the canvas's floating card, drawn as a strip along its top
 * edge, driven by pointer drag or by the arrow/Home/End keys.
 */
export function usePromptResize() {
  const [height, setHeight] = useState(MIN_PROMPT_HEIGHT);
  const resizeRef = useRef<{ pointerId: number; startY: number; startHeight: number } | null>(null);
  const onPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeRef.current = { pointerId: event.pointerId, startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [height]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setHeight(clamp(resize.startHeight + resize.startY - event.clientY));
  }, []);
  const onPointerEnd = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);
  const onLostPointerCapture = useCallback(() => { resizeRef.current = null; }, []);
  const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 16;
    if (event.key === 'ArrowUp') setHeight((current) => clamp(current + step));
    else if (event.key === 'ArrowDown') setHeight((current) => clamp(current - step));
    else if (event.key === 'Home') setHeight(MIN_PROMPT_HEIGHT);
    else if (event.key === 'End') setHeight(MAX_PROMPT_HEIGHT);
    else return;
    event.preventDefault();
  }, []);
  return {
    height,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onLostPointerCapture,
      onKeyDown,
    },
  };
}
