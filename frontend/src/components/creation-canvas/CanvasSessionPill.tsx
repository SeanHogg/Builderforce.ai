// No 'use client' directive: these are only ever rendered by `CreationCanvas`, which is
// already a client component, so the boundary is inherited and a second declaration here
// would only add another file to the architecture ratchet's client-component tally — the
// same reason `CanvasSessionActions` omits it.
import { Icon } from '@/components/ui/Icon';
import styles from './CreationCanvas.module.css';

/**
 * "Something just happened" — floating in the canvas's top-left corner.
 *
 * The session's NAME lives in the left rail's session list now, not here: the two used to
 * say the same title in two places at once, and this is the one that lost, since the rail
 * is also where the name is renamed. The realtime connection light moved there too — the
 * rail is where the session's own status now lives entirely, so this card is left with
 * exactly the one fact that is not a session-list concern: what the last outcome was.
 *
 * It owns its own visibility rather than making every caller remember to wrap it: routine
 * save chatter ("Saving…", "Saved on this device") never reaches here at all, and once an
 * outcome's hold expires the caller clears the notice to `''` instead of replacing it —
 * so the card disappears rather than sitting in the corner announcing nothing new.
 */

export interface CanvasSessionPillProps {
  /** The last outcome worth saying, or '' once it has nothing to add. */
  notice: string;
}

export function CanvasSessionPill({ notice }: CanvasSessionPillProps) {
  if (!notice) return null;
  return (
    <div className={`${styles.floatCard} ${styles.sessionPill}`} data-testid="canvas-session-pill">
      <span className={styles.spark} aria-hidden><Icon source="✦" size="1em" /></span>
      <span className={styles.pillStatus}>
        <span className={styles.saved}>{notice}</span>
      </span>
    </div>
  );
}
