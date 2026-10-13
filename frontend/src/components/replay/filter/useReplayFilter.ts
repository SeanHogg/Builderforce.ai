/**
 * THE Insights filter's state, synced with the address (PRD 33 §3.4, S4c).
 *
 * `InsightsScopeProvider` owns the one `ReplayFilter` through
 * `useReplayFilterState`, so every band and panel kind reads the same filter
 * from `useInsightsScope()` — there is no second copy. The address carries it
 * as `f.<field>.<op>=<value>` (`filterToQuery`), so a filtered view is a link:
 *
 *   state → address: every change is written with `history.replaceState`
 *     through `withFilterQuery`, keeping every other parameter (site, panel);
 *   address → state: a client navigation (`useSearchParams`) or Back/Forward
 *     (`popstate`) that changes the `f.*` params replaces the filter.
 *
 * Loop-free by ONE marker, `agreed`: the canonical filter query both sides last
 * agreed on; each side acts only on a key different from it.
 *
 * The pure clause helpers (`addClause`, `removeClauseAt`) are what the filter
 * bar, the breakdown rows and the frustration tiles call — adding a clause on a
 * field+op already present replaces it, so a click never stacks a duplicate.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  MAX_FILTER_CLAUSES,
  filterFromQuery,
  filterToQuery,
  withFilterQuery,
  type ReplayFilter,
  type ReplayFilterClause,
} from '@builderforce/interaction-contract';

/** Canonical key of a filter (its query string). */
export function filterKey(filter: ReplayFilter): string {
  return filterToQuery(filter).toString();
}

/** The filter the current address carries ('' search → the empty filter). */
export function filterFromAddress(): ReplayFilter {
  if (typeof window === 'undefined') return { all: [] };
  return filterFromQuery(window.location.search);
}

/** `filter` plus `clause`; a clause on the same field and op is replaced in place. */
export function addClause(filter: ReplayFilter, clause: ReplayFilterClause): ReplayFilter {
  const index = filter.all.findIndex((c) => c.field === clause.field && c.op === clause.op);
  if (index >= 0) return { all: filter.all.map((c, i) => (i === index ? clause : c)) };
  if (filter.all.length >= MAX_FILTER_CLAUSES) return filter;
  return { all: [...filter.all, clause] };
}

export function removeClauseAt(filter: ReplayFilter, index: number): ReplayFilter {
  return { all: filter.all.filter((_, i) => i !== index) };
}

function writeAddress(filter: ReplayFilter): void {
  const query = withFilterQuery(window.location.search, filter).toString();
  const href = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (href !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', href);
  }
}

export interface ReplayFilterState {
  filter: ReplayFilter;
  setFilter: (filter: ReplayFilter) => void;
}

/**
 * The filter state owner. `initial` (a host that already knows the filter)
 * wins over the address on mount, and is then written to it.
 */
export function useReplayFilterState(initial?: ReplayFilter): ReplayFilterState {
  const [filter, setFilterRaw] = useState<ReplayFilter>(() => initial ?? filterFromAddress());
  /** The filter key state and address last agreed on; null until the first write. */
  const agreed = useRef<string | null>(null);

  // state → address
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = filterKey(filter);
    if (key === agreed.current) return;
    agreed.current = key;
    if (key !== filterKey(filterFromAddress())) writeAddress(filter);
  }, [filter]);

  // address → state (client navigation, Back/Forward)
  const searchKey = useSearchParams()?.toString() ?? '';
  const [popCount, setPopCount] = useState(0);
  useEffect(() => {
    const onPop = () => setPopCount((n) => n + 1);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  useEffect(() => {
    if (agreed.current === null) return;
    const fromAddress = filterFromAddress();
    const key = filterKey(fromAddress);
    if (key === agreed.current) return;
    agreed.current = key;
    setFilterRaw(fromAddress);
  }, [searchKey, popCount]);

  const setFilter = useCallback((next: ReplayFilter) => setFilterRaw(next), []);
  return { filter, setFilter };
}
