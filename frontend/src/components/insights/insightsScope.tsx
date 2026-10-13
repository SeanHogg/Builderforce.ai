/**
 * What the Insights home is looking at: the site, the window, the goal, the
 * filter, the release to compare and the route on the Page stage.
 * The filter is the ONE `ReplayFilter`, owned here and synced with the address.
 *
 * ONE context, so the bands (registered in `HOME_BANDS`) and the panel kinds
 * (registered in `INSIGHT_PANEL_KINDS`) take no props beyond their identity
 * and read the same numbers — a band cannot show 30 days while the panel it
 * opens shows 7.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { ReplayFilter } from '@builderforce/interaction-contract';
import type { ReplayWindow } from '@/lib/replayApi';
import { useReplayFilterState } from '@/components/replay/filter/useReplayFilter';
import type { InsightGoal } from './insightGoals';

export interface InsightsScope {
  siteId: string;
  days: ReplayWindow;
  setDays: (days: ReplayWindow) => void;
  goal: InsightGoal;
  setGoal: (goal: InsightGoal) => void;
  filter: ReplayFilter;
  setFilter: (filter: ReplayFilter) => void;
  /** Release key to compare against, or null. */
  compare: string | null;
  setCompare: (releaseKey: string | null) => void;
  /** The route on the Page stage, or null until an issue picks one. */
  route: string | null;
  setRoute: (route: string | null) => void;
}

const ScopeContext = createContext<InsightsScope | null>(null);

export function InsightsScopeProvider({
  siteId,
  initialFilter,
  initialDays = 30,
  children,
}: {
  siteId: string;
  /** Omitted: the filter the address carries (`?f.*`), kept in sync with it (`useReplayFilterState`). */
  initialFilter?: ReplayFilter;
  initialDays?: ReplayWindow;
  children: ReactNode;
}) {
  const [days, setDays] = useState<ReplayWindow>(initialDays);
  const [goal, setGoal] = useState<InsightGoal>('activation');
  const { filter, setFilter } = useReplayFilterState(initialFilter);
  const [compare, setCompare] = useState<string | null>(null);
  const [route, setRoute] = useState<string | null>(null);
  const value = useMemo<InsightsScope>(
    () => ({ siteId, days, setDays, goal, setGoal, filter, setFilter, compare, setCompare, route, setRoute }),
    [siteId, days, goal, filter, setFilter, compare, route],
  );
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}

export function useInsightsScope(): InsightsScope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error('useInsightsScope must be used inside InsightsScopeProvider');
  return scope;
}
