/**
 * The recordings table: `RECORDING_COLUMNS` (data) sorted by the shared
 * `useTableSort`, a row and its Watch button opening the recording. Owns no
 * fetch — `RecordingsList` pages a filtered query into it, a funnel step's
 * `DroppedRecordings` feeds it the recordings that dropped there.
 */

import { useTranslations } from 'next-intl';
import type { ReplayRecordingSummaryDto } from '@builderforce/interaction-contract';
import { SortableTh, useTableSort } from '@/components/admin/adminShared';
import { RECORDING_COLUMNS, RECORDING_COMPARATORS, type RecordingColumnId } from './recordingColumns';

export interface RecordingsTableProps {
  rows: ReplayRecordingSummaryDto[];
  onOpen: (recordingId: string) => void;
}

export function RecordingsTable({ rows, onOpen }: RecordingsTableProps) {
  const t = useTranslations('replay.list');
  const { sort, toggle, sorted } = useTableSort<RecordingColumnId, ReplayRecordingSummaryDto>(
    rows,
    RECORDING_COMPARATORS,
    { key: 'when', direction: 'desc' },
  );

  return (
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
  );
}
