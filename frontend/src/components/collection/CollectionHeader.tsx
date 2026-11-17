'use client';

import { useTranslations } from 'next-intl';
import { ViewToggle } from '@/components/ViewToggle';
import { Select } from '@/components/Select';

/**
 * CollectionHeader — the pinned header for a Collection (PRD 47 §3.1). Holds
 * the search input, the filter `children` slot, the result count, the Card-mode
 * "Sort by" select (listing the sortable columns), the ViewToggle, and — when
 * the entity models archive — the uniform Active / Archived / All segmented
 * filter (archived=exclude | only | all, the param brainRoutes already uses).
 * Only the body scrolls; the header stays pinned.
 */
export interface CollectionHeaderProps<Row> {
  descriptor: CollectionDescriptor<Row>;
  view: string;
  onViewChange: (view: string) => void;
  /** Extra views (board/calendar/gantt) passed through to the ViewToggle. */
  extraViews?: { board?: boolean; calendar?: boolean; gantt?: boolean };
  search: string;
  onSearchChange: (q: string) => void;
  total: number;
  loading?: boolean;
  /** Card-mode "Sort by" select — lists the sortable columns. */
  sort: { key: string; dir: 'asc' | 'desc' };
  onSortChange: (key: string) => void;
  /** The uniform archived filter (exclude|only|all); omitted hides the control. */
  archived?: 'exclude' | 'only' | 'all';
  onArchivedChange?: (next: 'exclude' | 'only' | 'all') => void;
  /** Filter controls rendered in the header slot. */
  children?: React.ReactNode;
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexWrap: 'wrap',
  paddingBottom: 12,
  borderBottom: '1px solid var(--border-subtle)',
  flexShrink: 0,
};

const searchInputStyle: React.CSSProperties = {
  padding: '8px 12px',
  minHeight: 40,
  fontSize: 'var(--font-size-small)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg-elevated)',
  color: 'var(--text-primary)',
  minWidth: 200,
};

const segmented: React.CSSProperties = {
  display: 'inline-flex',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius-md)',
  padding: 2,
};

const segmentedBtn = (active: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  minHeight: 40,
  fontSize: 'var(--font-size-small)',
  fontWeight: 600,
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  background: active ? 'var(--coral-bright)' : 'transparent',
  color: active ? 'var(--text-on-accent)' : 'var(--text-secondary)',
});

const countStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-small)',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
};

export function CollectionHeader<Row>({
  descriptor,
  view,
  onViewChange,
  extraViews,
  search,
  onSearchChange,
  total,
  loading,
  sort,
  onSortChange,
  archived,
  onArchivedChange,
  children,
}: CollectionHeaderProps<Row>) {
  const t = useTranslations('common.collection');
  const tp = useTranslations('common.pagination');
  const sortableColumns = descriptor.columns.filter((c) => c.sortKey ?? c.compare);
  const showSortSelect = view === 'card' && sortableColumns.length > 0;
  const showArchived = archived != null && onArchivedChange != null;

  return (
    <div style={headerStyle}>
      <input
        type="search"
        aria-label={t('search')}
        placeholder={t('search')}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        style={searchInputStyle}
      />
      {showArchived && (
        <div role="group" aria-label={t('archivedFilter.label')} style={segmented}>
          {(['exclude', 'only', 'all'] as const).map((val) => (
            <button
              key={val}
              type="button"
              data-archived={val}
              onClick={() => onArchivedChange?.(val)}
              aria-pressed={archived === val}
              style={segmentedBtn(archived === val)}
            >
              {t(`archivedFilter.${val}`)}
            </button>
          ))}
        </div>
      )}
      {children}
      <span style={countStyle} aria-live="polite">
        {tp('resultCount', { n: total })}
      </span>
      {showSortSelect && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--font-size-small)', color: 'var(--text-muted)' }}>
          {t('sortBy')}
          <Select
            aria-label={t('sortBy')}
            value={sort.key}
            onChange={(e) => onSortChange(e.target.value)}
            style={{ minWidth: 140 }}
          >
            {sortableColumns.map((col) => (
              <option key={col.key} value={col.sortKey ?? col.key}>
                {col.header}
              </option>
            ))}
          </Select>
        </label>
      )}
      <ViewToggle
        value={view}
        onChange={onViewChange}
        board={extraViews?.board}
        calendar={extraViews?.calendar}
        gantt={extraViews?.gantt}
      />
      {loading ? <span style={countStyle}>{t('loading')}</span> : null}
    </div>
  );
}
