import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BULK_MAX } from './collectionTypes';

/**
 * useCollectionSelection — the shared checkbox-selection model for a Collection
 * (PRD 47 §3.1). Replaces the four hand-rolled copies (creation library, task
 * mgmt, session list, suspect accounts).
 *
 * Contract:
 *  - A `Set<string>` keyed by row id, so it SURVIVES page changes.
 *  - A FILTER CHANGE clears it (the caller passes a `filterKey` that changes
 *    when any filter/search does; the effect clears on change).
 *  - The header checkbox is PAGE-SCOPED: `pageState` reports none / some / all
 *    for the current page's ids, `indeterminate` when only some are selected.
 *  - `selectAllMatching()` is capped at BULK_MAX (1000).
 */
export type PageSelectionState = 'none' | 'some' | 'all';

export interface CollectionSelection {
  selected: Set<string>;
  count: number;
  isSelected: (id: string) => boolean;
  toggle: (id: string) => void;
  selectMany: (ids: string[]) => void;
  deselectMany: (ids: string[]) => void;
  clear: () => void;
  /** none / some / all of the CURRENT page is selected. */
  pageState: (pageIds: string[]) => PageSelectionState;
  /** True when only part of the page is selected (→ indeterminate checkbox). */
  isIndeterminate: (pageIds: string[]) => boolean;
  /** Select or clear the current page. */
  togglePage: (pageIds: string[]) => void;
  /** Replace the selection with all matching ids, capped at BULK_MAX. */
  selectAllMatching: (ids: string[]) => void;
}

export function useCollectionSelection(filterKey: string): CollectionSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  // The filter key the current selection was made under; a change clears it.
  const filterRef = useRef(filterKey);
  useEffect(() => {
    if (filterRef.current !== filterKey) {
      filterRef.current = filterKey;
      setSelected(new Set());
    }
  }, [filterKey]);

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectMany = useCallback((ids: string[]) => {
    setSelected((prev) => new Set([...prev, ...ids]));
  }, []);

  const deselectMany = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const pageState = useCallback(
    (pageIds: string[]): PageSelectionState => {
      if (pageIds.length === 0) return 'none';
      let hit = 0;
      for (const id of pageIds) if (selected.has(id)) hit += 1;
      if (hit === 0) return 'none';
      return hit === pageIds.length ? 'all' : 'some';
    },
    [selected],
  );

  const isIndeterminate = useCallback(
    (pageIds: string[]) => pageState(pageIds) === 'some',
    [pageState],
  );

  const togglePage = useCallback(
    (pageIds: string[]) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (pageState(pageIds) === 'all') for (const id of pageIds) next.delete(id);
        else for (const id of pageIds) next.add(id);
        return next;
      });
    },
    [pageState],
  );

  const selectAllMatching = useCallback((ids: string[]) => {
    setSelected(new Set(ids.slice(0, BULK_MAX)));
  }, []);

  const count = selected.size;
  const isSelected = useCallback((id: string) => selected.has(id), [selected]);

  return useMemo(
    () => ({
      selected, count, isSelected, toggle, selectMany, deselectMany, clear,
      pageState, isIndeterminate, togglePage, selectAllMatching,
    }),
    [selected, count, isSelected, toggle, selectMany, deselectMany, clear, pageState, isIndeterminate, togglePage, selectAllMatching],
  );
}
