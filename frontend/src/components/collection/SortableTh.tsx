import { useTranslations } from 'next-intl';

/**
 * SortableTh — the sortable header cell for a Collection's List mode
 * (PRD 47 §3.1). A header button carries `aria-sort`; a click cycles
 * asc → desc on the same key. Non-sortable columns render a plain `<th>`.
 */
export interface SortableThProps {
  header: React.ReactNode;
  sortKey?: string;
  activeKey: string;
  dir: 'asc' | 'desc';
  onSort: (key: string) => void;
  width?: string;
  align?: 'start' | 'end';
  sticky?: boolean;
}

const thBase: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  textAlign: 'start',
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  color: 'var(--text-secondary)',
  padding: '10px 12px',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border-subtle)',
  whiteSpace: 'nowrap',
  zIndex: 1,
};

export function SortableTh({ header, sortKey, activeKey, dir, onSort, width, align, sticky }: SortableThProps) {
  const t = useTranslations('common.collection');
  const sortable = sortKey != null;
  const active = sortable && activeKey === sortKey;
  const ariaSort = !sortable ? undefined : active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none';

  return (
    <th
      scope="col"
      aria-sort={ariaSort}
      style={{
        ...thBase,
        ...(width ? { width } : null),
        ...(align === 'end' ? { textAlign: 'end' } : null),
        ...(sticky ? { left: 0, zIndex: 2 } : null),
      }}
    >
      {sortable ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          aria-label={t('sortByColumn', { column: typeof header === 'string' ? header : '' })}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            minHeight: 40,
            color: active ? 'var(--coral-bright)' : 'var(--text-secondary)',
          }}
        >
          {header}
          {active && <span aria-hidden="true">{dir === 'asc' ? '▲' : '▼'}</span>}
        </button>
      ) : (
        header
      )}
    </th>
  );
}
