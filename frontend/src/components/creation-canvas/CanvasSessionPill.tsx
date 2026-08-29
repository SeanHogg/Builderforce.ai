// No 'use client' directive: these are only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionActions` omits it.
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';

/**
 * "Is my work somewhere safe" — floating in the canvas's top-left corner.
 *
 * The session's NAME lives in the left rail's session list now, not here: the two used to
 * say the same title in two places at once, and this is the one that lost, since the rail
 * is also where the name is renamed. What is left is exactly the fact the rail cannot
 * report because it does not know the live connection state of the board on screen — the
 * save notice and the realtime light.
 */

export interface CanvasSessionPillProps {
  /** The save notice: "Saved", "Saved on this device", or an error. */
  notice: string;
  /** Absent when this canvas lives only on this device and has no connection to report. */
  realtimeState?: 'online' | 'offline' | 'reconnecting' | 'connecting';
}

export function CanvasSessionPill({ notice, realtimeState }: CanvasSessionPillProps) {
  const t = useTranslations('creationCanvas');
  return (
    <div className={`${styles.floatCard} ${styles.sessionPill}`} data-testid="canvas-session-pill">
      <span className={styles.spark} aria-hidden><Icon source="✦" size="1em" /></span>
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
