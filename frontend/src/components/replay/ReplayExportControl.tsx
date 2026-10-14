/**
 * "Export as video" (PRD 33 D10, §8 S4b): the QA runner renders the replay
 * headlessly to a video; it costs 10 units, once.
 *
 * Request → poll `exportStatus` every 5 s while it is queued or running (the
 * shared poll skips ticks while the tab is hidden) → download through the
 * authenticated transport. Every outcome the API can give — `unavailable`
 * (no runner), `failed` with a machine code (`insufficient_units`, …) — is
 * said plainly from the catalog, never as a raw code.
 *
 * Who may export: the API gates it like every Insights read (workspace member
 * + the Insights entitlement, `replayExportRoutes.ts`), with no role above
 * member, so every reader who can open the player can press it.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayExportDto, ReplayExportStatus } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { usePolledResource } from '@/hooks/usePolledResource';
import { useErrorText } from '@/i18n/useErrorMessage';
import { Icon } from '@/components/ui/Icon';

export const EXPORT_POLL_MS = 5_000;
const OPEN: ReadonlySet<ReplayExportStatus> = new Set(['queued', 'running']);
/** The API's machine-readable export errors (`EXPORT_ERRORS`), each a `replay.export.error.<code>` line. */
const KNOWN_ERRORS: ReadonlySet<string> = new Set(['runner_unavailable', 'insufficient_units', 'no_chunks', 'dispatch_failed', 'timed_out']);

export function ReplayExportControl({ siteId, recordingId }: { siteId: string; recordingId: string }) {
  const t = useTranslations('replay.export');
  const errorText = useErrorText();
  const [job, setJob] = useState<ReplayExportDto | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [failure, setFailure] = useState('');
  const open = job !== null && OPEN.has(job.status);

  usePolledResource(async (signal) => {
    if (!job) return;
    const next = await replayApi.exportStatus(siteId, job.id);
    if (!signal.aborted) setJob(next);
  }, { intervalMs: EXPORT_POLL_MS, enabled: open, immediate: false, restartKey: job?.id ?? null });

  async function start() {
    setRequesting(true);
    setFailure('');
    try {
      setJob(await replayApi.requestExport(siteId, recordingId));
    } catch (error) {
      setFailure(errorText(error) || t('error.generic'));
    } finally {
      setRequesting(false);
    }
  }

  async function download() {
    if (!job) return;
    setFailure('');
    try {
      await replayApi.downloadExport(siteId, job.id);
    } catch (error) {
      void error;
      setFailure(t('downloadFailed'));
    }
  }

  const ended = job !== null && (job.status === 'failed' || job.status === 'unavailable');
  const problem = job && ended
    ? (job.error && KNOWN_ERRORS.has(job.error)
      ? t(`error.${job.error}`)
      : t(job.status === 'unavailable' ? 'error.runner_unavailable' : 'error.generic'))
    : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)', minWidth: 0 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn-secondary"
          style={{ minHeight: 44 }}
          disabled={requesting || open}
          onClick={() => void start()}
          title={t('cost')}
        >
          <Icon name="download" size={16} /> {requesting ? t('requesting') : t('button')}
        </button>
        {job?.status === 'done' && (
          <button type="button" className="btn-primary" style={{ minHeight: 44 }} onClick={() => void download()}>
            {t('download')}
          </button>
        )}
      </div>
      {!job && !failure && <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('cost')}</p>}
      {open && job && <p role="status" style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t(`status.${job.status}`)}</p>}
      {job?.status === 'done' && <p role="status" style={{ margin: 0, color: 'var(--success)', fontSize: 'var(--font-size-small)' }}>{t('status.done')}</p>}
      {(problem || failure) && (
        <p role="alert" style={{ margin: 0, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{problem || failure}</p>
      )}
    </div>
  );
}
