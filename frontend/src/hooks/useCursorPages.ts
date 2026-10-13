/**
 * A cursor-paginated list: the first page whenever `requestKey` changes, more
 * pages appended on demand, and a retry.
 *
 * `requestKey` names the query (site, window, filter…) so a caller passes a
 * plain inline `fetchPage` — the latest one is read through a ref, the way
 * `usePolledResource` does — and the list refetches exactly when the query
 * changes. State is only ever written from a settled request or an event
 * handler, and a page that arrives for a superseded key is dropped.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

interface PagesState<T> {
  key: string;
  items: T[];
  cursor: string | null;
  error: unknown;
}

export interface CursorPages<T> {
  items: T[];
  /** True until the first page for this key settles, and while more is loading. */
  loading: boolean;
  error: unknown;
  hasMore: boolean;
  loadMore: () => void;
  retry: () => void;
}

export function useCursorPages<T>(requestKey: string, fetchPage: (cursor: string | null) => Promise<CursorPage<T>>): CursorPages<T> {
  const fetchRef = useRef(fetchPage);
  useEffect(() => { fetchRef.current = fetchPage; });
  const [state, setState] = useState<PagesState<T> | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchRef.current(null).then(
      (page) => { if (!cancelled) setState({ key: requestKey, items: page.items, cursor: page.nextCursor, error: null }); },
      (error: unknown) => { if (!cancelled) setState({ key: requestKey, items: [], cursor: null, error }); },
    );
    return () => { cancelled = true; };
  }, [requestKey, attempt]);

  const current = state && state.key === requestKey ? state : null;
  const cursor = current?.cursor ?? null;

  const loadMore = useCallback(() => {
    if (!cursor) return;
    setLoadingMore(true);
    fetchRef.current(cursor).then(
      (page) => setState((prev) => (prev && prev.key === requestKey
        ? { ...prev, items: [...prev.items, ...page.items], cursor: page.nextCursor, error: null }
        : prev)),
      (error: unknown) => setState((prev) => (prev && prev.key === requestKey ? { ...prev, error } : prev)),
    ).finally(() => setLoadingMore(false));
  }, [cursor, requestKey]);

  const retry = useCallback(() => {
    setState(null);
    setAttempt((n) => n + 1);
  }, []);

  return {
    items: current?.items ?? [],
    loading: !current || loadingMore,
    error: current?.error ?? null,
    hasMore: cursor != null,
    loadMore,
    retry,
  };
}
