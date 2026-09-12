import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Open/close state for a composer popover — the ONE implementation of "opens on the
 * trigger, closes on an outside press or Escape" that every composer menu shares: the
 * `/` options menu, the recipient and persona pickers, and the VS Code webview's `+`
 * menu. Attach `rootRef` to the element that contains BOTH the trigger and the
 * popover, so a press inside either never counts as outside.
 */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<T>(null);
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, toggle, close, rootRef };
}
