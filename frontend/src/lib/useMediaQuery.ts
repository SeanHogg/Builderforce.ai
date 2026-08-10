'use client';

import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query from React — the one implementation behind every
 * "is it narrow / is it touch / does it prefer dark" hook in the app.
 *
 * Two properties every caller needs and none should have to re-derive:
 *
 *  - **SSR-safe.** `false` on the server and the first client paint, then synced on
 *    mount. A one-frame settle, never a hydration mismatch — which is why callers must
 *    treat `false` as "not yet known", not as "definitely not".
 *  - **Absent-API-safe.** jsdom does not implement `matchMedia` at all, so a hook that
 *    calls it unguarded throws inside any test that merely mounts a component using it.
 *    Requiring every consumer's test file to stub a browser API is how that guard ends
 *    up copied into some call sites and forgotten in others.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const sync = () => setMatches(mql.matches);
    sync();
    mql.addEventListener('change', sync);
    return () => mql.removeEventListener('change', sync);
  }, [query]);

  return matches;
}
