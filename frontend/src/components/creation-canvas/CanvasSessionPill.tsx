// No 'use client' directive: these are only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionActions` omits it.
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';

/**
 * "Is my work somewhere safe" — floating in the canvas's top-left corner.
 *
 * The session's NAME lives in the left rail's session list now, not here: the two used to
 * say the same title in two places at once, and this is the one that lost, since the rail
 * is also where the name is renamed. The realtime connection light moved there too — the
 * rail is where the session's own status now lives entirely, so this card is left with
 * exactly the one fact that is not a session-list concern: the save notice.
 */

export interface CanvasSessionPillProps {
  /** The save notice: "Saved", "Saved on this device", or an error. */
  notice: string;
}

export function CanvasSessionPill({ notice }: CanvasSessionPillProps) {
  return (
    <div className={`${styles.floatCard} ${styles.sessionPill}`} data-testid="canvas-session-pill">
      <span className={styles.spark} aria-hidden><Icon source="✦" size="1em" /></span>
      <span className={styles.pillStatus}>
        <span className={styles.saved}>{notice}</span>
      </span>
    </div>
  );
}
