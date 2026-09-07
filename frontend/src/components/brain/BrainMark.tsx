// No 'use client': the mark is pure presentation with no hooks, state or browser API,
// so it inherits whichever boundary its host already declared and renders in a server
// tree unchanged. Declaring one here would only add a file to the architecture
// ratchet's client-component tally — the same reason `CanvasSessionPill` omits it.
import { Icon } from '@/components/ui/Icon';
import styles from './BrainMark.module.css';

/**
 * THE Brain mark — one glyph, one working animation, every surface.
 *
 * Brain used to be drawn two different ways depending on where you were standing: the
 * app-wide floating launcher wore the brain, while the canvas — the dock header, the
 * chat surface, the launcher pill, the Brain Object on the board — wore a four-point
 * spark. Same assistant, two identities, and the one people learn first (the launcher
 * that follows them across every other page) was the one the canvas dropped. This is
 * the single mark, so opening Brain on the canvas is visibly the same Brain.
 *
 * It also owns the PROCESSING signal rather than leaving each host to invent one: a
 * ring breathing out of the mark plus a gentle pulse of the glyph itself. That is a
 * shape, not words — the phase, the tool and the token count are narrated once by
 * `BrainActivityBar`, and a mark that repeated them would be the second copy that
 * component exists to prevent. Hosts pass `running` from the activity state they
 * already hold; nothing else about the animation is theirs to decide.
 *
 * Colour is inherited (`currentColor`), so each host's own accent still applies and
 * the mark reads in both themes without a palette of its own.
 */
export interface BrainMarkProps {
  /** A turn is in flight: the mark breathes and a ring pulses out of it. */
  running?: boolean;
  /** Glyph size — any CSS length. Defaults to `1em` so it inherits its host's type. */
  size?: number | string;
}

export function BrainMark({ running = false, size = '1em' }: BrainMarkProps) {
  return (
    <span
      className={styles.mark}
      style={{ fontSize: typeof size === 'number' ? `${size}px` : size }}
      data-state={running ? 'running' : 'idle'}
      aria-hidden
    >
      {running && (
        <>
          <span className={styles.pulse} />
          <span className={`${styles.pulse} ${styles.pulseTrail}`} />
        </>
      )}
      <span className={styles.glyph}><Icon name="brain" size="1em" /></span>
    </span>
  );
}
