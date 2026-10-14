/**
 * The Insights panel's stack (D16: ONE panel, levels stacked with a breadcrumb).
 *
 * Bands and kinds open things with `usePanel().push(level)`; the breadcrumb
 * pops; Esc and the close button clear. The state lives here rather than in
 * `InsightsPanel` so any band can push without being handed a callback.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { InsightPanelLevel } from './panelKinds';

export interface PanelStackApi {
  levels: readonly InsightPanelLevel[];
  /** Open a level on top. Pushing the level already on top updates its tab / time instead of stacking a copy. */
  push: (level: InsightPanelLevel) => void;
  /** Drop the top level, or keep only the first `depth` levels. */
  pop: (depth?: number) => void;
  close: () => void;
  /** Replace the whole stack (a `?panel=` link on load). */
  replace: (levels: readonly InsightPanelLevel[]) => void;
  /** Switch the top level's tab. */
  setTab: (tab: string) => void;
}

const PanelContext = createContext<PanelStackApi | null>(null);

function sameTarget(a: InsightPanelLevel, b: InsightPanelLevel): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function InsightsPanelProvider({ children }: { children: ReactNode }) {
  const [levels, setLevels] = useState<readonly InsightPanelLevel[]>([]);

  const push = useCallback((level: InsightPanelLevel) => {
    setLevels((current) => {
      const top = current[current.length - 1];
      if (top && sameTarget(top, level)) return [...current.slice(0, -1), { ...top, ...level }];
      return [...current, level];
    });
  }, []);

  const pop = useCallback((depth?: number) => {
    setLevels((current) => (depth == null ? current.slice(0, -1) : current.slice(0, Math.max(0, depth))));
  }, []);

  const close = useCallback(() => setLevels([]), []);
  const replace = useCallback((next: readonly InsightPanelLevel[]) => setLevels(next), []);

  const setTab = useCallback((tab: string) => {
    setLevels((current) => {
      const top = current[current.length - 1];
      if (!top) return current;
      // A tab switch is a new moment: the time a link carried belongs to the tab it was made on.
      return [...current.slice(0, -1), { kind: top.kind, id: top.id, tab, ...(top.follow ? { follow: true } : {}) }];
    });
  }, []);

  const value = useMemo<PanelStackApi>(
    () => ({ levels, push, pop, close, replace, setTab }),
    [levels, push, pop, close, replace, setTab],
  );
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanel(): PanelStackApi {
  const api = useContext(PanelContext);
  if (!api) throw new Error('usePanel must be used inside InsightsPanelProvider');
  return api;
}

/** The panel when there is one (a card shown outside the Insights home links instead of pushing). */
export function useOptionalPanel(): PanelStackApi | null {
  return useContext(PanelContext);
}
