/**
 * Kept recordings, newest first, cursor-paginated (PRD 33 §4.1: panel lists
 * page; home lists are bounded).
 *
 * Owns its fetch so any panel level can drop it in with a filter: the issue
 * kind's recordings tab, a funnel step, a flow node. The table (registry
 * columns, shared sort) is `RecordingsTable`.
 */

import { useTranslations } from 'next-intl';
import type { ReplayFilter, ReplayRecordingSummaryDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useCursorPages } from '@/hooks/useCursorPages';
import { RecordingsTable } from './RecordingsTable';

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
      <RecordingsTable rows={rows} onOpen={onOpen} />
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
