'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Open/close state for a popup that must close on an outside click or Escape.
 *
 * Every dropdown in the session bar needs exactly this, and hand-rolling it per
 * menu is how one of them ends up without an Escape handler or leaking a
 * document listener. Attach `ref` to the element that contains BOTH the trigger
 * and the popup — a click inside it is never "outside".
 */
export function useDismissable<T extends HTMLElement = HTMLDivElement>(): {
  open: boolean;
  toggle: () => void;
  close: () => void;
  ref: React.RefObject<T | null>;
} {
  const [open, setOpen] = useState(false);
  // React 19 types `useRef<T>(null)` as `RefObject<T | null>` — the null the ref
  // genuinely holds before mount is now in the type rather than asserted away,
  // and that is exactly what the JSX `ref` prop accepts. `.current` is still
  // nullable at the read sites below, as it always was.
  const ref = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return {
    open,
    toggle: useCallback(() => setOpen((value) => !value), []),
    close: useCallback(() => setOpen(false), []),
    ref,
  };
}
