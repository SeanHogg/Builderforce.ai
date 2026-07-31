'use client';

import { useState, useEffect } from 'react';

/**
 * Reactive "is this a narrow (mobile) viewport?" flag for the many surfaces that
 * are laid out with inline styles and so cannot reach for a CSS `@media` block.
 * Matches the repo's CSS breakpoint (`@media (max-width: 640px)`) by default so
 * JS-driven and CSS-driven responsiveness agree.
 *
 * SSR-safe: renders `false` on the server + first client paint, then syncs to the
 * real match on mount (a one-frame settle, never a hydration mismatch).
 */
export function useIsMobile(maxWidth = 640): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const sync = () => setIsMobile(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [maxWidth]);

  return isMobile;
}
