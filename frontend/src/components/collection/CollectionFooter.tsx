'use client';

import { useTranslations } from 'next-intl';
import Pagination from '@/components/Pagination';
import { PAGE_SIZES } from './collectionTypes';

/**
 * CollectionFooter — the pinned footer for a Collection (PRD 47 §3.1). The
 * range text ("1–50 of 4,453") is announced through `aria-live="polite"`, the
 * pager is the canonical `components/Pagination.tsx`, and the per-page select
 * offers 50 | 100 | 250. Only the body scrolls; the footer stays pinned.
 */
export interface CollectionFooterProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  flexWrap: 'wrap',
  padding: '10px 4px 0',
  borderTop: '1px solid var(--border-subtle)',
  flexShrink: 0,
};

const rangeStyle: React.CSSProperties = {
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

export function CollectionFooter({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: CollectionFooterProps) {
  const t = useTranslations('common.collection');
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pageCount);
  const startIndex = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const endIndex = Math.min(current * pageSize, total);

  return (
    <div style={footerStyle}>
      <span style={rangeStyle} aria-live="polite" data-testid="collection-range">
        {total <= pageSize
          ? t('resultCount', { n: total })
          : t('range', { start: startIndex, end: endIndex, total })}
      </span>
      <Pagination page={current} pageCount={pageCount} onChange={onPageChange} />
      <label style={perPageStyle}>
        {t('perPage')}
        <select
          aria-label={t('perPage')}
          style={selectStyle}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
