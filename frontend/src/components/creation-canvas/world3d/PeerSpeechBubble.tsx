/*
 * No `'use client'` — mounted only inside surfaces reached through a
 * `dynamic(..., { ssr: false })` import, since WebGL has no server-side render.
 */
import { Html } from '@react-three/drei';
import styles from './PeerSpeechBubble.module.css';

/**
 * What somebody at the table is saying, floating over their head.
 *
 * DOM rather than geometry for the reason the name plate is (see `PeerAvatar`): it has
 * to wrap, follow the reader's theme and stay legible at any distance. It is anchored by
 * its BOTTOM edge, so a four-line reply grows upward, away from the name plate beneath
 * it, instead of spreading over it from the middle. The full reply is in the Brain
 * transcript; the bubble is the gist, clamped to a few lines.
 *
 * ── WHY THE BUBBLE IS A BUTTON ───────────────────────────────────────────────────
 * Clamping to four lines is what keeps six people's replies readable in one room, but
 * it also means the bubble is an EXCERPT — and until it was clickable, the reader who
 * wanted the rest had to leave the room and find the message themselves in a transcript
 * where several agents answered the same turn. The bubble already knows which message
 * it is quoting, so it takes the reader there.
 *
 * Interactive ONLY when the host wires `onSelect` and there is a message to go to: a
 * "thinking…" bubble quotes nothing yet, and a room with no transcript surface has
 * nowhere to send anyone. In both cases it renders as the plain, non-focusable text it
 * always was — and `pointerEvents` stays `none` so it never eats a click meant for the
 * scene behind it.
 */
export interface PeerSpeechBubbleProps {
  /** Already clipped (`speechExcerpt`), or the translated "thinking" line. */
  text: string;
  /** Still working on a reply — drawn quieter than an answer. */
  pending: boolean;
  /** Where the bubble's bottom edge floats, in metres above the figure's origin. */
  height: number;
  /** Take the reader to the full reply in the transcript. Absent ⇒ not interactive. */
  onSelect?: (() => void) | undefined;
  /** Accessible name for the jump, e.g. "Show this reply in the chat". */
  selectLabel?: string | undefined;
}

export function PeerSpeechBubble({ text, pending, height, onSelect, selectLabel }: PeerSpeechBubbleProps) {
  return (
    // Above the name plates (`[10, 0]`), so a bubble is never cut by the plate of a
    // seat standing in front of it. The layer only accepts the pointer when something
    // in it is actually clickable; otherwise the scene behind keeps every click.
    <Html
      position={[0, height, 0]}
      distanceFactor={9}
      pointerEvents={onSelect ? 'auto' : 'none'}
      zIndexRange={[20, 11]}
    >
      <div className={styles.anchor} data-pending={pending ? 'true' : 'false'}>
        {onSelect ? (
          <button
            type="button"
            className={`${styles.bubble} ${styles.clickable}`}
            // The excerpt is the visible label; the title says what clicking DOES, so
            // the button is not announced as just a fragment of somebody's sentence.
            title={selectLabel}
            aria-label={selectLabel ? `${text} — ${selectLabel}` : text}
            onClick={(event) => {
              // The room listens for clicks to move and to select objects. Without this
              // the same click that opens the reply also walks the reader somewhere.
              event.stopPropagation();
              onSelect();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {text}
          </button>
        ) : (
          <p className={styles.bubble} aria-live="polite">{text}</p>
        )}
      </div>
    </Html>
  );
}
