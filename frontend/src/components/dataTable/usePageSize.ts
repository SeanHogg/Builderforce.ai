'use client';

import React from 'react';

/**
 * usePageSize — the shared "results per page" control for every list/table.
 *
 * Every long list across the app (tasks, projects, sessions, recordings, admin
 * tables, …) was rendering its full result set in one pass — the "4,453 tasks"
 * board being the worst case. Standardizing on client-side pagination needs a
 * single hook so page size can't drift between surfaces. The allowed page sizes
 * (50 / 100 / 200) come from the design contract; DEFAULT_PAGE_SIZE is what a
 * surface shows before the viewer ever touches the control.
 *
 * The setter clamps the size to a legal value — anything outside 50/100/200
 * falls back to the default so a stray value can never produce an empty page.
 */

export const PAGE_SIZE_OPTIONS = [50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 50;

export interface PageSizeControl {
  size: PageSize;
  setSize: (next: number) => void;
}

export function usePageSize(initial: PageSize = DEFAULT_PAGE_SIZE): PageSizeControl {
  const [size, setSizeState] = React.useState<PageSize>(initial);
  const setSize = React.useCallback((next: number) => {
    const legal = (PAGE_SIZE_OPTIONS as readonly number[]).includes(next)
      ? (next as PageSize)
      : DEFAULT_PAGE_SIZE;
    setSizeState(legal);
  }, []);
  return { size, setSize };
}
