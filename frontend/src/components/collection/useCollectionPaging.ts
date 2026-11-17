'use client';

import { useCallback, useState } from 'react';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, type PageSize } from './collectionTypes';

/**
 * useCollectionPaging — page + pageSize (50 / 100 / 250, default 50) for a
 * Collection surface. Changing the size resets to page 1 (PRD 47 §3.2); sort
 * and filter changes reset to page 1 too, via the `reset` handle the surface
 * calls from those effects. This is the shared hook the per-surface copies in
 * `dataTable/usePageSize.ts` converge onto (PAGE_SIZE_OPTIONS moves to
 * 50/100/250 here, per W0).
 */
export interface CollectionPaging {
  page: number;
  pageSize: PageSize;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  /** Reset to page 1 (call when sort or a filter changes). */
  reset: () => void;
  pageCount: (total: number) => number;
}

export function useCollectionPaging(initial: PageSize = DEFAULT_PAGE_SIZE): CollectionPaging {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState<PageSize>(initial);

  const setPageSize = useCallback((next: number) => {
    // Clamp to a legal value so a stray size can never produce an empty page.
    const legal = (PAGE_SIZES as readonly number[]).includes(next) ? (next as PageSize) : DEFAULT_PAGE_SIZE;
    setSize(legal);
    setPage(1);
  }, []);

  const reset = useCallback(() => setPage(1), []);
  const pageCount = useCallback((total: number) => Math.max(1, Math.ceil(total / size)), [size]);

  return { page, pageSize: size, setPage, setPageSize, reset, pageCount };
}
