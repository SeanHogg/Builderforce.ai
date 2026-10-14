/**
 * "Watch the N who dropped" (PRD 33 §2.1 "Funnels"): the recordings that
 * reached the previous step and not this one. The evaluation names them by id
 * (≤ 20); each is read through `replayApi.getRecording` and drawn in the shared
 * `RecordingsTable`, a row opening the `recording` kind. A recording that has
 * since aged out of retention is skipped, not an error.
 */

import { useTranslations } from 'next-intl';
import type { ReplayRecordingSummaryDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { PanelPending } from '@/components/insights/kinds/PanelPending';
import { RecordingsTable } from '../RecordingsTable';

export const DROPPED_RECORDINGS_CAP = 20;

export async function loadRecordings(siteId: string, ids: readonly string[]): Promise<ReplayRecordingSummaryDto[]> {
  const settled = await Promise.allSettled(ids.slice(0, DROPPED_RECORDINGS_CAP).map((id) => replayApi.getRecording(siteId, id)));
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

export function DroppedRecordings({ siteId, ids, onOpen }: { siteId: string; ids: readonly string[]; onOpen: (recordingId: string) => void }) {
  const t = useTranslations('replay.funnels');
  const { data, loading, error } = useAdminData(() => loadRecordings(siteId, ids), [siteId, ids.join(',')]);
  if (!data) return <PanelPending loading={loading} error={error} />;
  if (data.length === 0) return <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('droppedGone')}</p>;
  return <RecordingsTable rows={data} onOpen={onOpen} />;
}
