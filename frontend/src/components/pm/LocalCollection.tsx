'use client';

import React, { useMemo, useState } from 'react';
import { Collection, type CollectionExtraViews } from '@/components/collection/Collection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import type { CollectionSource } from '@/components/collection/sources';

/**
 * LocalCollection — renders an in-memory, READ-ONLY list through the one shared
 * `<Collection>` (PRD 47).
 *
 * `Collection` owns its sort + paging chrome state internally and exposes no
 * hook to drive a source from it, so a local source cannot be sliced by the
 * Collection's own page. These catalogs (manager backlog / run tasks / activity /
 * stalls, PM ROI tables, Portfolio Health cards) are bounded, client-side reads
 * with no bulk API (`entity: null`), so the adapter hands `Collection` the whole
 * filtered set: `total` equals the rows passed, so the footer reads as a plain
 * count and no pager that cannot page is offered. Search is applied here.
 *
 * Column sorting inside the table is applied by `Collection` through the
 * descriptor, so the adapter pre-sorts by the descriptor's default sort to give
 * the initial order; columns with `compare` re-sort via the header.
 */
export interface LocalCollectionProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  rows: Row[];
  /** Search text for a row; omit to make the search box a no-op. */
  searchText?: (row: Row) => string;
  extraViews?: CollectionExtraViews;
  children?: React.ReactNode;
  className?: string;
}

export function LocalCollection<Row>({ descriptor, rows, searchText, extraViews, children, className }: LocalCollectionProps<Row>) {
  const [search, setSearch] = useState('');

  const source = useMemo<CollectionSource<Row>>(() => {
    const q = search.trim().toLowerCase();
    const filtered = q && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(q)) : rows;
    return { rows: filtered, total: filtered.length, loading: false, refetch: () => undefined };
  }, [rows, search, searchText]);

  return (
    <Collection
      descriptor={descriptor}
      source={source}
      extraViews={extraViews}
      search={search}
      onSearchChange={setSearch}
      className={className}
    >
      {children}
    </Collection>
  );
}
