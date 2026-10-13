/**
 * Who is on the site right now (PRD 33 S5, D6: polling about every 5 s, paused
 * while the tab is hidden). Active count, visitors by route, and one tile per
 * visitor; a recorded visitor's tile opens the recording in follow mode.
 *
 * `route` narrows the view to one page — the home's Page stage uses it as its
 * Live lens.
 */

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ReplayLiveDto } from '@builderforce/interaction-contract';
import { replayApi } from '@/lib/replayApi';
import { usePolledResource } from '@/hooks/usePolledResource';
import { useErrorText } from '@/i18n/useErrorMessage';
import { useFormat } from '@/i18n/useFormat';
import { BarChart } from '@/components/charts/BarChart';

export const LIVE_POLL_MS = 5_000;

export interface LiveViewProps {
  siteId: string;
  route?: string | null;
  onOpenRecording: (recordingId: string) => void;
  /** Hide the by-route bars (the Page stage lens shows one route). */
  compact?: boolean;
}

export function LiveView({ siteId, route = null, onOpenRecording, compact = false }: LiveViewProps) {
  const t = useTranslations('replay.live');
  const tPlayer = useTranslations('replay.player');
  const fmt = useFormat();
  const errorText = useErrorText();
  const [live, setLive] = useState<ReplayLiveDto | null>(null);
  const [error, setError] = useState('');

  usePolledResource(async (signal) => {
    try {
      const next = await replayApi.getLive(siteId);
      if (signal.aborted) return;
      setLive(next);
      setError('');
    } catch (err) {
      if (!signal.aborted) setError(errorText(err));
      throw err;
    }
  }, { intervalMs: LIVE_POLL_MS, restartKey: siteId });

  if (!live) {
    return error
      ? <p role="alert" style={{ margin: 0, color: 'var(--error)' }}>{t('error')} {error}</p>
      : <p role="status" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('loading')}</p>;
  }

  const visitors = route ? live.visitors.filter((visitor) => visitor.route === route) : live.visitors;
  const active = route ? visitors.length : live.active;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', minWidth: 0 }}>
      <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 'var(--font-size-section)', fontWeight: 700, color: 'var(--text-primary)' }}>
        {t('active', { count: active })}
      </p>
      {error && <p role="alert" style={{ margin: 0, color: 'var(--error)', fontSize: 'var(--font-size-small)' }}>{error}</p>}

      {!compact && live.byRoute.length > 0 && (
        <section aria-label={t('byRoute')}>
          <h3 style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--font-size-small)', color: 'var(--text-secondary)' }}>{t('byRoute')}</h3>
          <BarChart
            monochrome
            maxRows={8}
            labelWidth={140}
            ariaLabel={t('byRoute')}
            data={live.byRoute.map((row) => ({ key: row.route, label: row.route, value: row.n }))}
          />
        </section>
      )}

      {visitors.length === 0 ? (
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 'var(--space-2)' }}>
          {visitors.map((visitor) => {
            const body = (
              <>
                <span style={{ display: 'block', color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>{visitor.route}</span>
                <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>
                  {tPlayer(`deviceClass.${visitor.deviceClass}`)} · {t('lastSeen', { time: fmt.relative(visitor.lastSeenAt) })}
                </span>
                {!visitor.recordingId && (
                  <span style={{ display: 'block', color: 'var(--text-secondary)', fontSize: 'var(--font-size-small)' }}>{t('notRecorded')}</span>
                )}
              </>
            );
            const tile = {
              width: '100%',
              minHeight: 44,
              padding: 'var(--space-2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--surface-card)',
              textAlign: 'left' as const,
            };
            return (
              <li key={visitor.visitId}>
                {visitor.recordingId ? (
                  <button
                    type="button"
                    style={{ ...tile, cursor: 'pointer', color: 'inherit' }}
                    aria-label={t('watchAria', { route: visitor.route })}
                    onClick={() => onOpenRecording(visitor.recordingId!)}
                  >
                    {body}
                  </button>
                ) : (
                  <div style={tile}>{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
