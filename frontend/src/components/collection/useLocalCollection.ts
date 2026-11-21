import { useCallback, useMemo, useState } from 'react';
import type { CollectionDescriptor } from './descriptor';
import { useLocalSource, type CollectionSource } from './sources';
import type { CollectionPaging } from './useCollectionPaging';
import type { CollectionSort } from './useCollectionSort';
import { useCollectionState } from './useCollectionState';

/**
 * useLocalCollection — an in-memory list bound to a Collection's sort + paging
 * (PRD 47 §3.1). Owns the chrome state (`useCollectionState`), optionally
 * filters by search, then sorts + slices through `useLocalSource`. Pass the
 * returned `sort` and `paging` into `<Collection>` so header and pager clicks
 * re-slice the rows.
 *
 * `searchText` omitted: `rows` are used as given (a page that filters with its
 * own search state passes the filtered rows). A `setSearch` change resets to
 * page 1.
 */
export interface LocalCollectionState<Row> {
  source: CollectionSource<Row>;
  sort: CollectionSort;
  paging: CollectionPaging;
  search: string;
  setSearch: (q: string) => void;
}

export function useLocalCollection<Row>(
  descriptor: CollectionDescriptor<Row>,
  rows: Row[],
  searchText?: (row: Row) => string,
): LocalCollectionState<Row> {
  const { paging, sort } = useCollectionState(descriptor);
  const [search, setSearchState] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
  }, [rows, search, searchText]);

  const source = useLocalSource(filtered, descriptor, { key: sort.key, dir: sort.dir }, {
    page: paging.page,
    pageSize: paging.pageSize,
  });

  const { reset } = paging;
  const setSearch = useCallback((q: string) => {
    setSearchState(q);
    reset();
  }, [reset]);

  return { source, sort, paging, search, setSearch };
}
