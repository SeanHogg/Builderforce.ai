import { useEffect, useRef } from 'react';

/**
 * Shared modal/drawer dismissal behaviour: while `open` is true, locks body
 * scroll and closes on Escape. Used by every slide-out/overlay (the marketing
 * mobile menu, the Brain drawer, …) so they all behave consistently.
 *
 * `onDismiss` is held in a ref so the effect only re-runs when `open` flips —
 * callers can pass an inline arrow without churning the listener.
 */
export function useModalDismiss(open: boolean, onDismiss: () => void) {
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
}
