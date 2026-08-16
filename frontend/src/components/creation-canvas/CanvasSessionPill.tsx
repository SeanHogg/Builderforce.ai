// No 'use client' directive: these are only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionActions` omits it.
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';

/**
 * What this canvas IS, floating in its top-left corner.
 *
 * ── WHAT THIS REPLACED ───────────────────────────────────────────────────────────
 * A 54px band across the whole window holding a title, a save notice, a connection
 * light, a surface switcher, seven action buttons, a roster and a save button — a header
 * that, at 1440px, was mostly empty space between things that had nothing to do with each
 * other. The band is gone. Its contents did not disappear; they were sorted by what they
 * SAY and floated where that answer belongs, which is the table in `canvasChrome.ts`.
 *
 * This piece carries the two slots that answer "what am I looking at, and is it safe" —
 * `title` and `saveState`. Both are status, so this element has no collapsed form: there
 * is nothing here to fold away, and a canvas that cannot tell you its own name or whether
 * it is saved is not a canvas anyone should be typing into.
 *
 * ── WHY THE TITLE IS STILL AN INPUT ──────────────────────────────────────────────
 * Because renaming a canvas is a thing people do constantly and a thing they should never
 * have to open a settings panel for. It reads as a label until it is hovered, which is the
 * behaviour it had in the band and the only part of the band worth keeping.
 */

export interface CanvasSessionPillProps {
  title: string;
  onTitleChange: (title: string) => void;
  /** Called on blur — the canvas decides whether that means a server write. */
  onTitleCommit: () => void;
  /** The save notice: "Saved", "Saved on this device", or an error. */
  notice: string;
  /** Absent when this canvas lives only on this device and has no connection to report. */
  realtimeState?: 'online' | 'offline' | 'reconnecting' | 'connecting';
}

export function CanvasSessionPill({ title, onTitleChange, onTitleCommit, notice, realtimeState }: CanvasSessionPillProps) {
  const t = useTranslations('creationCanvas');
  return (
    <div className={`${styles.floatCard} ${styles.sessionPill}`} data-testid="canvas-session-pill">
      <span className={styles.spark} aria-hidden><Icon source="✦" size="1em" /></span>
      <input
        data-testid="canvas-session-title"
        aria-label={t('sessionTitle')}
        value={title}
        onChange={(event) => onTitleChange(event.target.value)}
        onBlur={onTitleCommit}
      />
      {/* One status line, not two stacked marks: the notice and the connection answer the
          same question ("is my work somewhere safe") and reading them as one phrase is
          what stops a pill this small turning into a dashboard. */}
      <span className={styles.pillStatus}>
        <span className={styles.saved}>{notice}</span>
        {realtimeState && <span
          role="status"
          aria-live="polite"
          className={styles.realtimeStatus}
          data-state={realtimeState}
        >{realtimeState === 'online' ? t('live') : realtimeState === 'offline' ? t('offlineRetry') : realtimeState === 'reconnecting' ? t('reconnecting') : t('connecting')}</span>}
      </span>
    </div>
  );
}
