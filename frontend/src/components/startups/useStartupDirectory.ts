'use client';

/**
 * The directory's read: query state, the paged fetch, and the inquiry target.
 *
 * Shared by the marketplace section and the explainer's teaser — BurnRateOS made
 * the same call (`useBusinessDirectory` fed both its `/businesses` grid and its
 * marketplace explorer) and it is the reason the fetch and the paging exist in
 * exactly one place. The search box is the STOREFRONT's, so `search` arrives as
 * a prop and is folded into the query here rather than owned twice.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { publicStartupApi, type DirectoryPage, type DirectoryQuery, type StartupCard } from '@/lib/startupDirectory';

export interface StartupDirectoryState {
  page: DirectoryPage | null;
  loading: boolean;
  error: string | null;
  query: DirectoryQuery;
  setQuery: (next: DirectoryQuery) => void;
  setPage: (page: number) => void;
  inquiring: StartupCard | null;
  openInquiry: (startup: StartupCard) => void;
  closeInquiry: () => void;
  reload: () => void;
}

export function useStartupDirectory(options: { search?: string; limit?: number; initial?: DirectoryQuery; enabled?: boolean } = {}): StartupDirectoryState {
  const { search = '', limit, initial, enabled = true } = options;
  const errorMessage = useErrorMessage();
  const [filters, setFilters] = useState<DirectoryQuery>({ sort: 'newest', page: 1, ...initial });
  const [page, setPageData] = useState<DirectoryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inquiring, setInquiring] = useState<StartupCard | null>(null);
  const [tick, setTick] = useState(0);

  // The storefront's search resets paging, exactly as changing a filter does.
  const query = useMemo<DirectoryQuery>(() => ({ ...filters, q: search, limit }), [filters, search, limit]);

  useEffect(() => {
    if (!enabled) { setLoading(false); return undefined; }
    let cancelled = false;
    setLoading(true);
    publicStartupApi.browse(query)
      .then((result) => { if (!cancelled) { setPageData(result); setError(null); } })
      .catch((cause: unknown) => { if (!cancelled) { setError(errorMessage(cause)); setPageData((prev) => prev ?? { startups: [], total: 0, page: 1, limit: limit ?? 12, totalPages: 1 }); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, enabled, errorMessage, limit, tick]);

  useEffect(() => { setFilters((f) => (f.page === 1 ? f : { ...f, page: 1 })); }, [search]);

  const setQuery = useCallback((next: DirectoryQuery) => setFilters({ ...next, page: next.page ?? 1 }), []);
  const setPage = useCallback((next: number) => setFilters((f) => ({ ...f, page: next })), []);

  return {
    page,
    loading,
    error,
    query,
    setQuery,
    setPage,
    inquiring,
    openInquiry: useCallback((startup: StartupCard) => setInquiring(startup), []),
    closeInquiry: useCallback(() => setInquiring(null), []),
    reload: useCallback(() => setTick((n) => n + 1), []),
  };
}
