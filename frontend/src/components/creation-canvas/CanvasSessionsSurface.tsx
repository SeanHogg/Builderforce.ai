/*
 * No `'use client'` here on purpose. Imported only by `CanvasSurfaceStage`, which
 * already sits behind the canvas client boundary, so a directive would mark a
 * second entry point that does not exist — the same reason `CanvasInsightsSurface`
 * states in its own header.
 */
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { adminSubHref } from '@/lib/adminGroups';
import styles from './CreationCanvas.module.css';

/**
 * Recordings of this canvas — the Measure-phase reading of "who used this".
 *
 * ── WHY THIS IS A DOOR, NOT A SECOND PLAYER ─────────────────────────────────────
 * Visitors (`Growth ▸ Visitors`) already owns the list, the recording panel and
 * the playback. Rebuilding that here would be the same drift `check-destinations`
 * exists to stop: two places that claim to play a session. This surface is the
 * canvas's own empty reading plus the one press that opens the place that already
 * plays them. The list of *this* canvas's visits lands in S4, through the replay
 * API, into the same panel — not a second one.
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

  return (
    <section
      className={styles.insightsSurface}
      data-testid="canvas-sessions-surface"
      aria-label={t('regionLabel')}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onExit(); } }}
    >
      <div className={styles.insightsSurfaceBody}>
        <div className={styles.insightsEmpty} role="status" data-testid="canvas-sessions-empty">
          <strong>{t('emptyTitle')}</strong>
          <p>{t('emptyBody')}</p>
          <Link href={visitorsHref}>{t('openFull')}</Link>
        </div>
      </div>
    </section>
  );
}
