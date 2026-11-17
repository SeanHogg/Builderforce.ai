'use client';

import { useTranslations } from 'next-intl';
import type { CollectionDescriptor } from './descriptor';
import type { CollectionSelection } from './useCollectionSelection';
import { SortableTh } from './SortableTh';

/**
 * CollectionTable — the List-mode body (PRD 47 §3.1). A `<table>` with a sticky
 * `<thead>`; the checkbox column is sticky-left so it stays visible when the
 * body scrolls horizontally, and the FIRST DATA COLUMN is sticky-left beside
 * it. Each sortable column renders a `SortableTh`. Horizontal scrolling happens
 * INSIDE the body (the Collection's scroll container), never the page — the
 * layout must not overflow at 360px.
 */
export interface CollectionTableProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  rows: Row[];
  selection: CollectionSelection | null;
  sort: { key: string; dir: 'asc' | 'desc' };
  onSort: (key: string) => void;
}

const checkboxTh: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  top: 0,
  zIndex: 3,
  width: 44,
  padding: '10px 8px',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border-subtle)',
};

const firstColTh: React.CSSProperties = {
  position: 'sticky',
  left: 44,
  top: 0,
  zIndex: 2,
  background: 'var(--bg-elevated)',
};

const tdBase: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-primary)',
  borderBottom: '1px solid var(--border-subtle)',
  whiteSpace: 'nowrap',
};

const checkboxStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  accentColor: 'var(--coral-bright)',
  cursor: 'pointer',
};

export function CollectionTable<Row>({ descriptor, rows, selection, sort, onSort }: CollectionTableProps<Row>) {
  const t = useTranslations('common.collection');
  const pageIds = rows.map((r) => descriptor.rowId(r));
  const state = selection?.pageState(pageIds) ?? 'none';
  const headerChecked = state === 'all';
  const indeterminate = state === 'some';
  const firstColKey = descriptor.columns[0]?.key;

  return (
    <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%' }}>
      <thead>
        <tr>
          {selection && (
            <th scope="col" style={checkboxTh}>
              <input
                type="checkbox"
                aria-label={t('selectPage')}
                checked={headerChecked}
                ref={(el) => {
                  if (el) el.indeterminate = indeterminate;
                }}
                onChange={() => selection.togglePage(pageIds)}
                style={checkboxStyle}
              />
            </th>
          )}
          {descriptor.columns.map((col, i) => (
            <SortableTh
              key={col.key}
              header={col.header}
              sortKey={col.sortKey ?? (col.compare ? col.key : undefined)}
              activeKey={sort.key}
              dir={sort.dir}
              onSort={onSort}
              width={col.width}
              align={col.align}
              sticky={i === 0}
            />
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const id = descriptor.rowId(row);
          return (
            <tr key={id}>
              {selection && (
                <td style={{ ...tdBase, position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-elevated)', width: 44 }}>
                  <input
                    type="checkbox"
                    aria-label={t('selectRow', { label: descriptor.label(row) })}
                    checked={selection.isSelected(id)}
                    onChange={() => selection.toggle(id)}
                    style={checkboxStyle}
                  />
                </td>
              )}
              {descriptor.columns.map((col, i) => (
                <td
                  key={col.key}
                  style={{
                    ...tdBase,
                    ...(col.align === 'end' ? { textAlign: 'end' } : null),
                    ...(i === 0 ? { position: 'sticky', left: selection ? 44 : 0, zIndex: 1, background: 'var(--bg-elevated)' } : null),
                    ...(i === 0 && firstColKey === col.key ? { minWidth: 160 } : null),
                  }}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
