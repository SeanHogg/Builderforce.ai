// No `'use client'`: imported only by client components, so it is already on the client side of the boundary.

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui';
import { useFormat } from '@/i18n/useFormat';
import type { SiteRecord } from '@/lib/growthApi';

/** More columns than this and a table stops being readable in a pane; the rest show in the row's tooltip. */
const MAX_COLUMNS = 8;

/**
 * A table has no declared columns — a row is whatever the form posted — so the
 * columns are the fields the loaded rows actually carry, in first-seen order.
 */
export function payloadColumns(records: SiteRecord[]): string[] {
  const seen = new Set<string>();
  for (const record of records) {
    for (const key of Object.keys(record.payload ?? {})) {
      if (key.toLowerCase() !== 'email') seen.add(key);
    }
  }
  return [...seen].slice(0, MAX_COLUMNS);
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

const cell: React.CSSProperties = {
  padding: '6px 8px', textAlign: 'left', verticalAlign: 'top',
  maxWidth: '18rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
};

/** One page of rows, scrolling sideways when the fields outgrow the pane. */
export function RecordsTable({ records, hasMore, onLoadMore, onDelete }: {
  records: SiteRecord[];
  hasMore: boolean;
  onLoadMore: () => Promise<unknown>;
  onDelete: (record: SiteRecord) => void;
}) {
  const t = useTranslations('builderDatabase.tables');
  const forms = useTranslations('site.forms');
  const fmt = useFormat();
  const columns = payloadColumns(records);

  return (
    <div style={{ display: 'grid', gap: 8, minWidth: 0 }}>
      <div style={{ overflowX: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-small)' }}>
          <thead style={{ background: 'var(--bg-surface)', color: 'var(--text-muted)' }}>
            <tr>
              <th scope="col" style={cell}>{forms('when')}</th>
              <th scope="col" style={cell}>{forms('email')}</th>
              {columns.map((column) => <th key={column} scope="col" style={cell}>{column}</th>)}
              <th scope="col" style={cell}><span className="sr-only">{t('actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id} style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-primary)' }}
                title={JSON.stringify(record.payload)}>
                <td style={{ ...cell, color: 'var(--text-muted)' }}>{fmt.dateTime(record.createdAt)}</td>
                <td style={cell}>{record.email ?? ''}</td>
                {columns.map((column) => <td key={column} style={cell}>{cellText(record.payload?.[column])}</td>)}
                <td style={{ ...cell, textAlign: 'right' }}>
                  <Button type="button" size="sm" variant="ghost" onClick={() => onDelete(record)} aria-label={t('deleteRow')}>
                    {t('deleteRow')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <Button type="button" size="sm" variant="secondary" onClick={() => { void onLoadMore(); }} style={{ justifySelf: 'start' }}>
          {t('loadMore')}
        </Button>
      )}
    </div>
  );
}
