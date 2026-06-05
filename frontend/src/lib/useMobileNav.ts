'use client';

import { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Mobile off-canvas drawer state, shared by the app + public shells. Opens from
 * the TopBar hamburger; auto-closes on route change and Escape, and locks body
 * scroll while open.
 */
export function useMobileNav(): { open: boolean; openNav: () => void; closeNav: () => void } {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Dismiss on navigation (covers bottom-bar taps + browser back). Reset during
  // render via the previous-value pattern — no setState-in-effect cascade.
  const [lastPath, setLastPath] = useState(pathname);
  if (pathname !== lastPath) {
    setLastPath(pathname);
    setOpen(false);
  }

  // Lock body scroll + close on Escape while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return { open, openNav: () => setOpen(true), closeNav: () => setOpen(false) };
}
