/*
 * No `'use client'` here on purpose. Imported only by `CanvasSurfaceStage`, which
 * already sits behind the canvas client boundary, so a directive would mark a
 * second entry point that does not exist — the same reason `CanvasInsightsSurface`
 * states in its own header.
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { adminSubHref } from '@/lib/adminGroups';
import { adminApi, type AdminReplayVisit } from '@/lib/adminApi';
import { formatDuration } from '@/lib/duration';
import styles from './CreationCanvas.module.css';

/**
 * Recordings of this canvas — the Measure-phase reading of "who used this".
 *
 * ── WHY THIS IS A DOOR, NOT A SECOND PLAYER ─────────────────────────────────────
 * Visitors (`Growth ▸ Visitors`) already owns the list, the recording panel and
 * the playback. Rebuilding that here would be the same drift `check-destinations`
 * exists to stop: two places that claim to play a session. This surface lists
 * this canvas's visits (S4) and still opens Visitors for playback — not a
 * second player.
 *
 * Layout reuses Insights' empty-reading CSS on purpose: both are board-scoped
 * Measure readings with nothing of their own to draw until data exists.
 */
export interface CanvasSessionsSurfaceProps {
  /** Escape hands the board back. No exit button: this surface is in the rail, so
   *  pressing Sessions again is the way out. */
  onExit: () => void;
}

export function CanvasSessionsSurface({ onExit }: CanvasSessionsSurfaceProps) {
  const t = useTranslations('creationCanvas.surface.sessions');
  const visitorsHref = adminSubHref('growth', 'visitors');
  const [visits, setVisits] = useState<AdminReplayVisit[]>([]);

  useEffect(() => {
    let cancelled = false;
    adminApi.replayVisits()
      .then((page) => { if (!cancelled) setVisits(page.visits); })
      .catch(() => { if (!cancelled) setVisits([]); });
    return () => { cancelled = true; };
  }, []);

  return (
    <section
      className={styles.insightsSurface}
      data-testid="canvas-sessions-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.insightsSurfaceBody}>
        {visits.length > 0 ? (
          <>
            <ol className={styles.sessionsVisitList} data-testid="canvas-sessions-list" aria-label={t('listLabel')}>
              {visits.map((visit) => (
                <li key={visit.visitId} className={styles.sessionsVisitRow} data-testid="canvas-sessions-visit">
                  <span className={styles.sessionsVisitPath}>{visit.entryPath || '/'}</span>
                  <span className={styles.sessionsVisitMeta}>{formatDuration(visit.durationMs)}</span>
                  {visit.converted ? <span className={styles.sessionsConverted}>{t('converted')}</span> : null}
                </li>
              ))}
            </ol>
            <div className={styles.sessionsVisitFooter}>
              <Link href={visitorsHref}>{t('openFull')}</Link>
            </div>
          </>
        ) : (
          <div className={styles.insightsEmpty} role="status" data-testid="canvas-sessions-empty">
            <strong>{t('emptyTitle')}</strong>
            <p>{t('emptyBody')}</p>
            <Link href={visitorsHref}>{t('openFull')}</Link>
          </div>
        )}
      </div>
    </section>
  );
}
