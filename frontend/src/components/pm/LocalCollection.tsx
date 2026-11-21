'use client';

import React from 'react';
import { Collection, type CollectionExtraViews } from '@/components/collection/Collection';
import type { CollectionDescriptor } from '@/components/collection/descriptor';
import { useLocalCollection } from '@/components/collection/useLocalCollection';

/**
 * LocalCollection — renders an in-memory, READ-ONLY list through the one shared
 * `<Collection>` (PRD 47).
 *
 * These catalogs (manager backlog / run tasks / activity / stalls, PM ROI
 * tables, Portfolio Health cards, alerts, compliance lenses) are bounded,
 * client-side reads with no bulk API (`entity: null`). `useLocalCollection`
 * owns the sort + paging state, filters by search and sorts + slices the rows;
 * the SAME sort/paging state goes to `<Collection>` so a header click or pager
 * change re-slices them. A search change resets to page 1.
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
  const { source, sort, paging, search, setSearch } = useLocalCollection(descriptor, rows, searchText);

  return (
    <Collection
      descriptor={descriptor}
      source={source}
      extraViews={extraViews}
      search={search}
      onSearchChange={setSearch}
      sort={sort}
      paging={paging}
      className={className}
    >
      {children}
    </Collection>
  );
}
