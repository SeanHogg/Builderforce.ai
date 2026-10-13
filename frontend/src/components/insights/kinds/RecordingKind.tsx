/**
 * The `recording` panel kind's three tabs (PRD 33 §4.1): Replay · Journey ·
 * Lead. Each is a plain component the registry row points at; the lead row
 * declares `requires: 'identified'`, so the panel — not this file — decides
 * whether it shows.
 */

import type { ReplayRecordingDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { useAdminData } from '@/components/admin/adminShared';
import { ReplayPlayer } from '@/components/replay/ReplayPlayer';
import { RecordingJourney } from '@/components/replay/RecordingJourney';
import { RecordingLead } from '@/components/replay/RecordingLead';
import type { InsightPanelKindProps } from '../panelKinds';
import { PanelPending as Pending } from './PanelPending';

function useRecording(siteId: string, id: string) {
  return useAdminData<ReplayRecordingDto>(() => replayApi.getRecording(siteId, id), [siteId, id]);
}

export function RecordingReplayTab({ siteId, id, t, follow }: InsightPanelKindProps) {
  return <ReplayPlayer siteId={siteId} recordingId={id} startAtSeconds={t ?? 0} follow={follow ?? false} />;
}

export function RecordingJourneyTab({ siteId, id, push }: InsightPanelKindProps) {
  const { data, loading, error } = useRecording(siteId, id);
  if (!data) return <Pending loading={loading} error={error} />;
  return (
    <RecordingJourney
      recording={data}
      onSeek={(atMs) => push({ kind: 'recording', id, tab: 'replay', t: Math.floor(atMs / 1000) })}
    />
  );
}

export function RecordingLeadTab({ siteId, id }: InsightPanelKindProps) {
  const { data, loading, error } = useRecording(siteId, id);
  if (!data) return <Pending loading={loading} error={error} />;
  return <RecordingLead recording={data} />;
}
