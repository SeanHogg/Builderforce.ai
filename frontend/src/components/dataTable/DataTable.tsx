'use client';

/**
 * DataTable — the standard TABLE chrome for every tabular collection.
 *
 * This is the tabular counterpart to {@link DataList}: same fixed header /
 * scrolling body / pinned footer contract, but renders a real <table> with a
 * sticky <thead> so the column labels stay on screen while the body scrolls,
 * and a pinned footer carrying the canonical {@link Pagination} control plus
 * the shared 50/100/200 results-per-page select.
 *
 * It absorbs the three table conventions that had drifted apart:
 *   - `.table-wrap` / `.data-table` (the CSS class pair in globals.css, used by
 *     ~38 admin panels) — same visual chrome, but no component enforcing a
 *     footer or page size.
 *   - `dataTableStyles.ts` (inline-style chrome shared by ~47 list views) —
 *     same look, again no pagination.
 *   - bespoke inline <table>s (the tasks board being the worst — 4,453 rows in
 *     one pass, no pager at all).
 *
 * All three converge here: fixed sticky header, only the current page rendered
 * (the load-time win), and a footer that never scrolls away.
 */

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Pagination from '@/components/Pagination';
import { PAGE_SIZE_OPTIONS, type PageSize } from './usePageSize';
import { tableWrapStyle, tableStyle, theadRowStyle, thStyle, trStyle, tdStyle, tdMutedStyle } from '@/components/dataTableStyles';

export interface DataTableColumn<Row> {
  key: string;
  header: React.ReactNode;
  /** Cell content for a row. */
  render: (row: Row, index: number) => React.ReactNode;
  /** Optional <th>/<td> style override (e.g. a narrow action column). */
  style?: React.CSSProperties;
  /** Mark a column as a row action cell (no wrap, right-aligned). */
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  /** All rows after the surface's own filtering/sorting — pagination slices this. */
  rows: Row[];
  columns: DataTableColumn<Row>[];
  /** Rendered instead of <td> cells when you need full control of a row (row-span,
   *  inline edit controls, group headers). `children` is the default <td> set. */
  renderRow?: (row: Row, cells: React.ReactNode, index: number) => React.ReactNode;
  rowKey?: (row: Row, index: number) => React.Key;
  /** Message when `rows` is empty (defaults to the localized "no results"). */
  empty?: React.ReactNode;
  page: number;
  onPageChange: (page: number) => void;
  pageSize: PageSize;
  onPageSizeChange: (size: number) => void;
  /** Extra footer content rendered beside the pager. */
  footerExtras?: React.ReactNode;
  className?: string;
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '10px 12px 0',
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

export function DataTable<Row>({
  rows,
  columns,
  renderRow,
  rowKey,
  empty,
  page,
  onPageChange,
  pageSize,
  onPageSizeChange,
  footerExtras,
  className,
}: DataTableProps<Row>) {
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

  const defaultCells = (row: Row, absoluteIndex: number) =>
    columns.map((col) => (
      <td
        key={col.key}
        style={{
          ...(col.numeric ? tdMutedStyle : tdStyle),
          ...(col.style ?? {}),
        }}
      >
        {col.render(row, absoluteIndex)}
      </td>
    ));

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ ...tableWrapStyle, overflowY: 'auto', maxHeight: '100%', flex: 1, minHeight: 0 }}>
        <table style={tableStyle}>
          <thead>
            <tr style={theadRowStyle}>
              {columns.map((col) => (
                <th key={col.key} style={{ ...thStyle, textAlign: col.numeric ? 'right' : 'left', ...(col.style ?? {}) }}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{ ...tdMutedStyle, textAlign: 'center', padding: 24 }}
                >
                  {empty ?? t('noResults')}
                </td>
              </tr>
            ) : (
              pageRows.map((row, i) => {
                const absoluteIndex = (current - 1) * pageSize + i;
                const cells = defaultCells(row, absoluteIndex);
                const body = renderRow ? renderRow(row, cells, absoluteIndex) : <tr style={trStyle}>{cells}</tr>;
                return (
                  <React.Fragment key={rowKey ? rowKey(row, i) : (row as { id?: React.Key })?.id ?? i}>
                    {body}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalCount > 0 && (
        <div style={footerStyle}>
          <span style={resultCountStyle}>
            {totalCount <= pageSize
              ? t('resultCount', { n: totalCount })
              : t('pageRangeOf', { start: startIndex, end: endIndex, total: totalCount })}
          </span>
          <Pagination page={current} pageCount={pageCount} onChange={onPageChange} ariaLabel={t('label')} />
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

export default DataTable;
