'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Lets a page publish per-tab counts that the shared <SectionTabs> bar (which is
 * decoupled from the page, in the app shell) renders as a badge — e.g. the
 * Projects count on the Projects tab. The page is the single source of the
 * number (it already fetches it); this just carries it the short distance from
 * page → shell tab bar, so neither re-fetches.
 *
 * Two contexts so a publisher's effect depends only on the STABLE setter (it
 * won't re-run — and flash the badge — every time some other count changes).
 */

type Counts = Record<string, number | null>;

const CountsCtx = createContext<Counts>({});
const SetCountCtx = createContext<(key: string, value: number | null) => void>(() => {});

export function NavCountsProvider({ children }: { children: React.ReactNode }) {
  const [counts, setCounts] = useState<Counts>({});
  const setCount = useCallback((key: string, value: number | null) => {
    setCounts((c) => (c[key] === value ? c : { ...c, [key]: value }));
  }, []);
  return (
    <SetCountCtx.Provider value={setCount}>
      <CountsCtx.Provider value={counts}>{children}</CountsCtx.Provider>
    </SetCountCtx.Provider>
  );
}

/** Read all published counts (call once; index by key — no hooks in loops). */
export function useNavCounts(): Counts {
  return useContext(CountsCtx);
}

/** Publish a count for a tab key. Updates on change, clears on unmount. */
export function usePublishNavCount(key: string, value: number | null | undefined): void {
  const setCount = useContext(SetCountCtx);
  const v = value ?? null;
  // Update whenever the value changes (no cleanup here → no null flash).
  useEffect(() => { setCount(key, v); }, [setCount, key, v]);
  // Clear only when the publisher unmounts.
  useEffect(() => () => setCount(key, null), [setCount, key]);
}
