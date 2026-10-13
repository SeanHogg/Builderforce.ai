/**
 * Kept recordings, newest first, cursor-paginated (PRD 33 §4.1: panel lists
 * page; home lists are bounded).
 *
 * Owns its fetch so any panel level can drop it in with a filter: the issue
 * kind's recordings tab, a funnel step, a flow node. Columns are the
 * `RECORDING_COLUMNS` registry; sorting is the shared `useTableSort`.
 */

import { useTranslations } from 'next-intl';
import type { ReplayFilter, ReplayRecordingSummaryDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useCursorPages } from '@/hooks/useCursorPages';
import { SortableTh, useTableSort } from '@/components/admin/adminShared';
import { RECORDING_COLUMNS, RECORDING_COMPARATORS, type RecordingColumnId } from './recordingColumns';

export interface RecordingsListProps {
  siteId: string;
  days: number;
  filter?: ReplayFilter | null;
  onOpen: (recordingId: string) => void;
}

export function RecordingsList({ siteId, days, filter = null, onOpen }: RecordingsListProps) {
  const t = useTranslations('replay.list');
  const errorText = useErrorText();
  const pages = useCursorPages<ReplayRecordingSummaryDto>(
    JSON.stringify([siteId, days, filter]),
    (cursor) => replayApi.listRecordings(siteId, { days, cursor, filter }),
  );
  const rows = pages.items;
  const loading = pages.loading;
  const error = pages.error ? errorText(pages.error) : '';

  const { sort, toggle, sorted } = useTableSort<RecordingColumnId, ReplayRecordingSummaryDto>(
    rows,
    RECORDING_COMPARATORS,
    { key: 'when', direction: 'desc' },
  );

  if (error && rows.length === 0) {
    return (
      <div role="alert" className="alert alert-error">
        <span>{t('error')}</span> <span>{error}</span>{' '}
        <button type="button" className="btn-ghost" onClick={pages.retry}>{t('retry')}</button>
      </div>
    );
  }
  if (!loading && rows.length === 0) {
    return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <div className="table-wrap" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              {RECORDING_COLUMNS.map((column) => (
                <SortableTh
                  key={column.id}
                  columnKey={column.id}
                  label={t(column.labelKey)}
                  sort={sort}
                  onSort={toggle}
                  sortLabel={t('sortBy', { column: t(column.labelKey) })}
                />
              ))}
              <th><span className="sr-only">{t('open')}</span></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} onClick={() => onOpen(row.id)} style={{ cursor: 'pointer' }}>
                {RECORDING_COLUMNS.map((column) => (
                  <td key={column.id}><column.Cell row={row} /></td>
                ))}
                <td>
                  <button
                    type="button"
                    className="btn-ghost"
                    style={{ minHeight: 44 }}
                    aria-label={t('openAria', { path: row.entryPath })}
                    onClick={(event) => { event.stopPropagation(); onOpen(row.id); }}
                  >
                    {t('open')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{error}</p>}
      {loading && <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>}
      {pages.hasMore && !loading && (
        <button type="button" className="btn-secondary" style={{ alignSelf: 'flex-start', minHeight: 44 }} onClick={pages.loadMore}>
          {t('loadMore')}
        </button>
      )}
    </div>
  );
}
