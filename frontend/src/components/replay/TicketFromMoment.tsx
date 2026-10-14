/**
 * Raise a ticket from this moment in a recording (PRD 33 S3, §5.3.4).
 *
 * For a Builderforce-hosted app (the site has a `projectId`) one press creates a
 * task on that project through the existing tasks client: "Replay: <what> at
 * <m:ss>", a body linking straight back to the recording at that second, and the
 * moment itself (`formatReplayMomentTrailer` — site, recording, time, release,
 * route, metric) so the API can measure the ticket's effect on the release that
 * ships the fix. An external site has no project to file into, so this renders
 * nothing there and the player's copy-link stays the way to share a moment.
 */

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  formatReplayMomentTrailer,
  type ReplayMark,
  type ReplayMoment,
  type ReplayMomentMetric,
  type ReplayRecordingDto,
} from '@builderforce/interaction-contract';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ToastProvider';
import { tasksApi } from '@/lib/builderforceApi';
import { replaySitesApi } from '@/lib/replaySitesApi';
import { useErrorMessage } from '@/i18n/useErrorMessage';
import { fmtClock } from './replayMarks';

/** How close before the playhead a signal mark has to be to name the moment. */
const MOMENT_LOOKBACK_MS = 5_000;
const FRUSTRATION_KINDS: ReadonlySet<string> = new Set(['rage', 'dead', 'quickback', 'excessive_scroll']);

/** The rollup metric a mark's kind speaks to — data, not a branch per caller. */
export function metricForMark(mark: Pick<ReplayMark, 'kind'> | null): ReplayMomentMetric {
  if (mark && FRUSTRATION_KINDS.has(mark.kind)) return 'frustrated';
  if (mark?.kind === 'error') return 'errors';
  return 'conversions';
}

/** The moment at `atMs`: its route, the signal mark that names it, and the metric. */
export function momentAt(recording: ReplayRecordingDto, siteId: string, atMs: number): { moment: ReplayMoment; label: string } {
  const before = recording.marks.filter((m) => m.atMs <= atMs);
  const page = [...before].reverse().find((m) => m.kind === 'page');
  const route = page?.key || recording.entryPath || '/';
  const signal = [...before].reverse().find((m) => m.kind !== 'page' && m.kind !== 'scroll' && m.kind !== 'vital' && atMs - m.atMs <= MOMENT_LOOKBACK_MS) ?? null;
  return {
    moment: { siteId, recordingId: recording.id, atMs: Math.floor(atMs), releaseKey: recording.releaseKey, metric: metricForMark(signal), route },
    label: (signal?.label || signal?.key || route).slice(0, 120),
  };
}

export interface TicketFromMomentProps {
  siteId: string;
  recording: ReplayRecordingDto | null;
  currentMs: number;
}

export function TicketFromMoment({ siteId, recording, currentMs }: TicketFromMomentProps) {
  const t = useTranslations('replay.ticket');
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [projectId, setProjectId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    replaySitesApi.get(siteId)
      .then((site) => { if (live) setProjectId(site?.kind === 'hosted' ? site.projectId : null); })
      .catch(() => { if (live) setProjectId(null); });
    return () => { live = false; };
  }, [siteId]);

  if (projectId === null || !recording) return null;

  const raise = async () => {
    const { moment, label } = momentAt(recording, siteId, currentMs);
    const time = fmtClock(moment.atMs);
    const seconds = Math.floor(moment.atMs / 1000);
    const link = `${window.location.origin}/apps/insights?site=${encodeURIComponent(siteId)}&panel=recording:${encodeURIComponent(recording.id)}&t=${seconds}`;
    setBusy(true);
    try {
      await tasksApi.create({
        projectId,
        title: t('title', { label, time }),
        description: `${t('body', { label, time, route: moment.route })}\n\n[${t('watchLink')}](${link})\n\n${formatReplayMomentTrailer(moment)}`,
      });
      toast.success(t('created'));
    } catch (cause) {
      toast.error(errorMessage(cause) ?? t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn-secondary" style={{ minHeight: 44 }} disabled={busy} onClick={() => void raise()}>
      <Icon name="flag" size={16} /> {t('raise', { time: fmtClock(currentMs) })}
    </button>
  );
}
