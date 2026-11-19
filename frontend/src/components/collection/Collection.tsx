'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CollectionDescriptor } from './descriptor';
import type { CollectionSource } from './sources';
import type { CollectionSelection } from './useCollectionSelection';
import { useCollectionSelection } from './useCollectionSelection';
import { useCollectionPaging, type CollectionPaging } from './useCollectionPaging';
import { useCollectionSort, type CollectionSort } from './useCollectionSort';
import { useCollectionPreferences, type CollectionView } from './collectionPreferences';
import { useBulkAction } from './useBulkAction';
import { CollectionHeader } from './CollectionHeader';
import { CollectionBulkBar } from './CollectionBulkBar';
import { CollectionTable } from './CollectionTable';
import { CollectionCards } from './CollectionCards';
import { CollectionFooter } from './CollectionFooter';

/**
 * Collection — the ONE Card | List collection every surface renders through
 * (PRD 47 §3.1). It composes the pinned header, the self-gating bulk bar, the
 * scrolling body and the pinned footer; the page holds only a descriptor and
 * its filters.
 *
 * Layout contract (§3.2): a flex column filling the parent with `min-height:0`
 * and the body `overflow:auto`, so only the rows/cards scroll while the header,
 * bulk bar, table `<thead>` and footer stay pinned. A parent that is NOT a flex
 * column gets a `max-height: calc(100dvh - var(--shell-topbar-height))` default.
 *
 * `extraViews={{ board, calendar, gantt }}` adds those modes to the ViewToggle
 * in canonical order and renders the supplied component in the body slot; the
 * header, filters and archived toggle still apply, and selection + the bulk bar
 * work in Board as well (the card checkbox).
 */
export interface CollectionExtraViews {
  board?: React.ComponentType<CollectionBodyProps<any>>;
  calendar?: React.ComponentType<CollectionBodyProps<any>>;
  gantt?: React.ComponentType<CollectionBodyProps<any>>;
}

/** What an extra-view component receives to render in the body slot. */
export interface CollectionBodyProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  rows: Row[];
  selection: CollectionSelection | null;
  loading: boolean;
}

export interface CollectionProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  source: CollectionSource<Row>;
  /** Extra board/calendar/gantt modes (canonical order) rendered in the body. */
  extraViews?: CollectionExtraViews;
  /** The list endpoint fetcher for select-all-matching (ids only, capped). */
  fetchAllIds?: () => Promise<string[]>;
  /** The uniform archived filter (exclude|only|all). */
  archived?: 'exclude' | 'only' | 'all';
  onArchivedChange?: (next: 'exclude' | 'only' | 'all') => void;
  /** Filter controls rendered in the header slot. */
  children?: React.ReactNode;
  /** Search state (empty string hides nothing). */
  search?: string;
  onSearchChange?: (q: string) => void;
  className?: string;
  /**
   * Page-owned sort/paging state. A page whose source depends on the sort/page
   * (a server source, or a local one it slices itself) creates these hooks, feeds
   * the source from them AND passes them here, so a header/pager click changes the
   * state the source reads. Omit both and Collection keeps its own (the source
   * must then not depend on either).
   */
  sort?: CollectionSort;
  paging?: CollectionPaging;
}

const rootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
  flex: 1,
  // A page that is not a flex column gets this default cap (§3.2).
  maxHeight: 'calc(100dvh - var(--shell-topbar-height))',
};

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  paddingTop: 12,
};

export function Collection<Row>({
  descriptor,
  source,
  extraViews,
  fetchAllIds,
  archived,
  onArchivedChange,
  children,
  search = '',
  onSearchChange,
  className,
  sort: sortProp,
  paging: pagingProp,
}: CollectionProps<Row>) {
  const t = useTranslations('common.collection');
  const prefs = useCollectionPreferences(descriptor.surfaceKey, descriptor.defaultView ?? 'table');
  const ownPaging = useCollectionPaging(prefs.pageSize);
  const paging = pagingProp ?? ownPaging;
  const ownSort = useCollectionSort(descriptor, paging.reset);
  const sort = sortProp ?? ownSort;

  // Changing a filter or the search clears the selection (§3.2).
  const filterKey = useMemo(
    () => `${search}|${archived ?? ''}`,
    [search, archived],
  );
  const selection = useCollectionSelection(filterKey);

  const view: string = useMemo(() => {
    const has = (v: string): boolean => {
      if (v === 'card' || v === 'table') return true;
      return extraViews?.[v as keyof CollectionExtraViews] != null;
    };
    return has(prefs.view) ? prefs.view : 'table';
  }, [prefs.view, extraViews]);

  // Keep paging in step with an external page-size preference change.
  useEffect(() => {
    if (prefs.pageSize !== paging.pageSize) paging.setPageSize(prefs.pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.pageSize]);

  const bulk = useBulkAction(descriptor.entity ?? 'project', {
    refetch: source.refetch,
    clearSelection: selection.clear,
  });

  const rows = source.rows;
  const pageIds = useMemo(() => rows.map((r) => descriptor.rowId(r)), [rows, descriptor]);

  const handleBulk = useCallback(
    (o: { action: 'delete' | 'archive' | 'restore' | 'merge'; ids: string[]; targetId?: string; dryRun?: boolean }) =>
      bulk.run({
        action: o.action,
        ids: o.ids,
        targetId: o.targetId,
        dryRun: o.dryRun,
        labelFor: (id) => {
          const row = rows.find((r) => descriptor.rowId(r) === id);
          return row ? descriptor.label(row) : id;
        },
      }),
    [bulk, rows, descriptor],
  );

  const handleFetchAllIds = useCallback(async (): Promise<string[]> => {
    if (fetchAllIds) return fetchAllIds();
    return pageIds;
  }, [fetchAllIds, pageIds]);

  const extraViewProps: CollectionBodyProps<Row> = {
    descriptor,
    rows,
    selection: descriptor.entity ? selection : null,
    loading: source.loading,
  };
  const ExtraBody = extraViews?.[view as keyof CollectionExtraViews];

  return (
    <div className={className} style={rootStyle} data-collection={descriptor.surfaceKey}>
      <CollectionHeader
        descriptor={descriptor}
        view={view}
        onViewChange={(v) => prefs.setView(v as CollectionView)}
        extraViews={{ board: !!extraViews?.board, calendar: !!extraViews?.calendar, gantt: !!extraViews?.gantt }}
        search={search}
        onSearchChange={onSearchChange ?? (() => undefined)}
        total={source.total}
        loading={source.loading}
        sort={sort}
        onSortChange={(key) => sort.setSort(key, sort.dir)}
        archived={archived}
        onArchivedChange={onArchivedChange}
      >
        {children}
      </CollectionHeader>

      <CollectionBulkBar
        descriptor={descriptor}
        selection={selection}
        rows={rows}
        total={source.total}
        pageSize={paging.pageSize}
        pageIds={pageIds}
        fetchAllIds={handleFetchAllIds}
        archived={archived ?? 'exclude'}
        onRefetch={source.refetch}
        onBulk={handleBulk}
      />

      <div style={bodyStyle} data-testid="collection-body">
        {source.total === 0 && !source.loading ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 'var(--font-size-small)' }}>
            {t(descriptor.emptyKey as never) ?? t('empty')}
          </div>
        ) : view === 'table' ? (
          <CollectionTable
            descriptor={descriptor}
            rows={rows}
            selection={descriptor.entity ? selection : null}
            sort={sort}
            onSort={sort.toggle}
          />
        ) : view === 'card' ? (
          <CollectionCards
            descriptor={descriptor}
            rows={rows}
            selection={descriptor.entity ? selection : null}
          />
        ) : ExtraBody ? (
          <ExtraBody {...extraViewProps} />
        ) : null}
      </div>

      <CollectionFooter
        page={paging.page}
        pageSize={paging.pageSize}
        total={source.total}
        onPageChange={paging.setPage}
        onPageSizeChange={(n) => {
          paging.setPageSize(n);
          prefs.setPageSize(n as 50 | 100 | 250);
        }}
      />
    </div>
  );
}
