import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Close an open popup on an outside press or Escape, for a caller that OWNS its open
 * state — a controlled panel, or one whose trigger and body sit in different rows of a
 * shared container.
 *
 * `ref` is the element containing BOTH the trigger and the popup: a press inside it is
 * never "outside". No listener is registered while `open` is false.
 */
export function useDismissOnOutsidePress(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onDismiss: () => void,
): void {
  // Read through a ref so a caller passing an inline arrow does not re-register the
  // document listeners on every render.
  const dismissRef = useRef(onDismiss);
  useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) dismissRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismissRef.current();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, ref]);
}

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
  const close = useCallback(() => setOpen(false), []);
  useDismissOnOutsidePress(ref, open, close);

  return {
    open,
    toggle: useCallback(() => setOpen((value) => !value), []),
    close,
    ref,
  };
}
