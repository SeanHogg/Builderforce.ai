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
 */
export interface PeerSpeechBubbleProps {
  /** Already clipped (`speechExcerpt`), or the translated "thinking" line. */
  text: string;
  /** Still working on a reply — drawn quieter than an answer. */
  pending: boolean;
  /** Where the bubble's bottom edge floats, in metres above the figure's origin. */
  height: number;
}

export function PeerSpeechBubble({ text, pending, height }: PeerSpeechBubbleProps) {
  return (
    // Above the name plates (`[10, 0]`), so a bubble is never cut by the plate of a
    // seat standing in front of it.
    <Html position={[0, height, 0]} distanceFactor={9} pointerEvents="none" zIndexRange={[20, 11]}>
      <div className={styles.anchor} data-pending={pending ? 'true' : 'false'}>
        <p className={styles.bubble} aria-live="polite">{text}</p>
      </div>
    </Html>
  );
}
