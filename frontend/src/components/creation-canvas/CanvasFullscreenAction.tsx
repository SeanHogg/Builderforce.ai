/*
 * No `'use client'` here on purpose. This is imported only by surfaces that
 * `CreationCanvas.tsx` mounts, and that file already declares the boundary —
 * `check-frontend-architecture` counts directives, not components.
 */
import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { useFullscreen } from '@/lib/useFullscreen';
import styles from './CreationCanvas.module.css';

/**
 * "Fill the screen with this" — the one full-screen control on the canvas.
 *
 * A game played in a 700px box under a session bar, a rail and a prompt is a
 * game you can see rather than one you can play, and that is what the surfaces
 * looked like before this existed. Both runtimes that hold a game need it, so
 * it is one component rather than a `requestFullscreen()` in each: the part
 * that is easy to get wrong is not the request, it is staying honest after the
 * user presses Escape (which fires no click), and that lives in
 * `useFullscreen`.
 *
 * It decides its own visibility from the browser rather than taking a boolean,
 * the same way `CanvasObjectSurfaceButton` does — inside an iframe without
 * `allow="fullscreen"` there is nothing to offer, and a button that silently
 * does nothing is worse than no button.
 *
 * The TARGET is the caller's, not this component's: the play surface fills the
 * screen with its stage, and the 3D space fills it with the stage AND the
 * palette, because a builder who goes full screen into a space they can no
 * longer edit has lost the thing they went in for.
 */

export interface CanvasFullscreenActionProps {
  target: RefObject<HTMLElement | null>;
}

export function CanvasFullscreenAction({ target }: CanvasFullscreenActionProps) {
  const t = useTranslations('creationCanvas.surface');
  const fullscreen = useFullscreen(target);
  if (!fullscreen.available) return null;

  const label = fullscreen.active ? t('exitFullscreen') : t('enterFullscreen');
  return (
    <button
      type="button"
      className={styles.objectSurfaceAction}
      onClick={fullscreen.toggle}
      aria-pressed={fullscreen.active}
      title={label}
    >
      <span aria-hidden>{fullscreen.active ? '⤡' : '⤢'}</span> {label}
    </button>
  );
}
