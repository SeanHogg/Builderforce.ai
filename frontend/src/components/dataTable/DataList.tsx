'use client';

/**
 * DataList — the standard list chrome for every long collection.
 *
 * One component gives every list the same fixed structure:
 *
 *   ┌─ header (fixed, sits above the scrolling body) ─┐
 *   │  result count · filters · bulk actions          │
 *   ├─ body (scrolls; renders only the current page)  ┤
 *   └─ footer (fixed, pinned under the body) ─────────┘
 *      ← 1 2 3 … ›      Results per page [50 ▾]
 *
 * The tasks board was rendering all 4,453 rows in a single pass — long enough
 * to jank the main thread and push the header off screen. Rendering only the
 * current page is the load-time win; the pinned header/footer is the UX win
 * (the column labels and the pager never scroll away).
 *
 * Layout contract: the component is height-flexible. In a column flex parent it
 * grows to fill the available height and the body scrolls internally; in a
 * plain block it renders the current page and the footer sits directly under
 * it. Either way header + footer are visually pinned relative to the body.
 *
 * `rows` is the FILTERED dataset (what a search/filter narrowed the list to);
 * the footer reports the result count and derives the page count from its length.
 */

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE_OPTIONS, type PageSize } from './usePageSize';

export interface DataListProps<Row> {
  /** All rows after the surface's own filtering/sorting — pagination slices this. */
  rows: Row[];
  /** Header content: filter controls, column labels, bulk-action bar, … */
  header?: React.ReactNode;
  /** Render a single row (or row group). Receives the item and its absolute index. */
  renderRow?: (row: Row, index: number) => React.ReactNode;
  /**
   * Take over the ENTIRE scrolling body instead of per-row rendering — for
   * surfaces that already have their own complex markup (an interactive
   * <table>, grouped sections) and only want the chrome: pinned header slot,
   * client-side pagination, pinned footer with the pager + page-size control.
   * Receives the current page's rows and the absolute index of the first one.
   */
  renderBody?: (pageRows: Row[], startIndex: number) => React.ReactNode;
  /** Row key — defaults to the item's `id`. */
  rowKey?: (row: Row, index: number) => React.Key;
  /** Current page, 1-based. */
  page: number;
  onPageChange: (page: number) => void;
  /** Selected results per page (50 / 100 / 200). */
  pageSize: PageSize;
  onPageSizeChange: (size: number) => void;
  /** Message when `rows` is empty. */
  empty?: React.ReactNode;
  /** Extra footer content rendered beside the pager (e.g. a total-cost figure). */
  footerExtras?: React.ReactNode;
  className?: string;
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '10px 4px 0',
  borderTop: '1px solid var(--border-subtle)',
};

const resultCountStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

const perPageStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 'var(--font-size-small)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
};

export function DataList<Row>({
  rows,
  header,
  renderRow,
  renderBody,
  rowKey,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
  empty,
  footerExtras,
  className,
}: DataListProps<Row>) {
  const t = useTranslations('common.pagination');
  const totalCount = rows.length;
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const current = Math.min(Math.max(page, 1), pageCount);

  const pageRows = useMemo(() => {
    const start = (current - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }, [rows, current, pageSize]);

  const startIndex = totalCount === 0 ? 0 : (current - 1) * pageSize + 1;
  const endIndex = Math.min(current * pageSize, totalCount);

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {header && <div style={{ flexShrink: 0 }}>{header}</div>}

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {totalCount === 0 ? (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
            {empty ?? t('noResults')}
          </div>
        ) : (
          renderBody ? (
            renderBody(pageRows, (current - 1) * pageSize)
          ) : (
            pageRows.map((row, i) => (
              <React.Fragment key={rowKey ? rowKey(row, i) : (row as { id?: React.Key })?.id ?? i}>
                {renderRow?.(row, (current - 1) * pageSize + i)}
              </React.Fragment>
            ))
          )
        )}
      </div>

      {totalCount > 0 && (
        <div style={footerStyle}>
          <span style={resultCountStyle}>
            {totalCount <= pageSize
              ? t('resultCount', { n: totalCount })
              : t('pageRangeOf', { start: startIndex, end: endIndex, total: totalCount })}
          </span>
          <Pagination
            page={current}
            pageCount={pageCount}
            onChange={onPageChange}
            ariaLabel={t('label')}
          />
          <label style={perPageStyle}>
            {t('perPage')}
            <select
              aria-label={t('perPage')}
              style={selectStyle}
              value={pageSize}
              onChange={(e) => {
                onPageSizeChange(Number(e.target.value));
                onPageChange(1);
              }}
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          {footerExtras}
        </div>
      )}
    </div>
  );
}

export default DataList;
