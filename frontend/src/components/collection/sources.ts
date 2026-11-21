import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CollectionDescriptor } from './descriptor';
import type { Page, PageQuery } from './collectionTypes';
import { resolveLocalCompare } from './useCollectionSort';

/**
 * CollectionSource<Row> — the data port a Collection renders from (PRD 47 §3.1).
 * Two flavours:
 *
 *  - `useLocalSource(rows, descriptor)` — a STATIC catalog already in memory.
 *    The hook sorts (via the column's `compare`) and slices to the page client-
 *    side; `total` is `rows.length`.
 *  - `useServerSource(fetchPage)` — a PAGED server endpoint. The fetcher is
 *    re-run whenever the `PageQuery` changes, and KEEPS THE PREVIOUS PAGE
 *    RENDERED while the next one loads (no empty flash between pages).
 *
 * Both return the same shape so `<Collection>` never branches on the source.
 */
export interface CollectionSource<Row> {
  /** Rows of the CURRENT page (or the previous page while the next loads). */
  rows: Row[];
  /** Total matching rows across all pages. */
  total: number;
  /** True while a server fetch is in flight. Local sources never set this. */
  loading: boolean;
  /** Re-run the current fetch (after a bulk mutation). */
  refetch: () => void;
}

/**
 * Fetcher for a server source. Receives the full PageQuery (page, pageSize,
 * sort, dir, archived, q). MUST pass `page` through to the endpoint — the
 * `check:collection-endpoints` guard keeps every fetcher honest about that.
 */
export type CollectionFetchPage<Row> = (query: PageQuery) => Promise<Page<Row>>;

/** A local source: client sort + slice over an in-memory catalog. */
export function useLocalSource<Row>(
  rows: Row[],
  descriptor: CollectionDescriptor<Row>,
  sort: { key: string; dir: 'asc' | 'desc' },
  paging: { page: number; pageSize: number },
): CollectionSource<Row> {
  const sorted = useMemo(() => {
    const compare = resolveLocalCompare(descriptor, sort.key);
    if (!compare) return rows;
    const copy = [...rows];
    copy.sort((a, b) => (sort.dir === 'asc' ? compare(a, b) : compare(b, a)));
    return copy;
  }, [rows, descriptor, sort.key, sort.dir]);

  // Clamp ONCE here: rows that shrink (a search, a delete) must never leave the
  // page past the end and render empty. `<Collection>` snaps the paging state to
  // match so the footer agrees.
  const pageRows = useMemo(() => {
    const lastPage = Math.max(1, Math.ceil(sorted.length / paging.pageSize));
    const page = Math.min(Math.max(1, paging.page), lastPage);
    const start = (page - 1) * paging.pageSize;
    return sorted.slice(start, start + paging.pageSize);
  }, [sorted, paging.page, paging.pageSize]);

  return useMemo(
    () => ({ rows: pageRows, total: sorted.length, loading: false, refetch: () => undefined }),
    [pageRows, sorted.length],
  );
}

/** A server source: one fetch per PageQuery, keeping the previous page while loading. */
export function useServerSource<Row>(
  fetchPage: CollectionFetchPage<Row>,
  query: PageQuery,
): CollectionSource<Row> {
  const { page: pageNumber, pageSize, sort, dir, archived, q } = query;
  // Bumped by `refetch` so the same query runs again.
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<{ page: Page<Row> } | null>(null);
  // The request the last fetch SETTLED (resolved or failed). `loading` is derived:
  // the current request has not settled yet — no setState inside the effect body.
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const requestKey = `${pageNumber}|${pageSize}|${sort}|${dir}|${archived}|${q ?? ''}|${reload}`;
  const fetchRef = useRef(fetchPage);
  useEffect(() => {
    fetchRef.current = fetchPage;
  }, [fetchPage]);

  useEffect(() => {
    // The cleanup cancels a superseded fetch, so a slow one can't clobber a newer one.
    let cancelled = false;
    fetchRef
      .current({ page: pageNumber, pageSize, sort, dir, archived, q })
      .then((next) => {
        if (cancelled) return;
        setState({ page: next });
        setSettledKey(requestKey);
      })
      .catch(() => {
        if (cancelled) return;
        // Keep the previous page on error; the surface's error handling is its
        // own, but a failed refetch never blanks the collection.
        setSettledKey(requestKey);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, pageNumber, pageSize, sort, dir, archived, q]);

  const refetch = useCallback(() => setReload((n) => n + 1), []);
  const loading = settledKey !== requestKey;

  // While loading, KEEP THE PREVIOUS PAGE rendered (state stays until the new
  // one resolves) — the PRD "keeps the previous page while loading" contract.
  const page = state?.page;
  const rows = useMemo(() => page?.items ?? [], [page]);
  const total = page?.total ?? 0;

  return useMemo(
    () => ({ rows, total, loading, refetch }),
    [rows, total, loading, refetch],
  );
}
