'use client';

import { useEffect, useState } from 'react';

/**
 * Publish the band the prompt actually owns, as `--composer-space` on the board.
 *
 * Every floating thing anchored to the bottom of the canvas — the command rail,
 * the outline, the Files panel, the Brain sheet and its launcher, the palette,
 * the inspector — sits at `bottom: calc(var(--composer-space) + 8px)`. That
 * variable was the literal `112px`, a guess at how tall the composer dock would
 * be, and the dock is not a fixed height: it grows by the utilities row the
 * moment a run starts ("Thought for 2s"), by a wrapped scope chip, and by a
 * multi-line prompt. On a phone, where the rail is a 38px-per-button column
 * pinned to the same corner, the guess being ~40px short is what put the
 * execution chip on top of the rail's last two commands.
 *
 * So it is MEASURED. The distance from the board's bottom edge to the dock's top
 * edge is the whole answer and needs no knowledge of the dock's own offset,
 * which differs by breakpoint (16px desktop, 8px phone) — reading the offset
 * would just be the same guess in a second place.
 *
 * Returns a callback ref for the dock. It is state-backed rather than a
 * `useRef`, because the dock unmounts in presentation mode and a plain ref
 * cannot tell the effect that it has: state re-runs the effect, which publishes
 * `0px` so the rail reclaims the space instead of avoiding a dock that is gone.
 */
export function useComposerSpace(board: React.RefObject<HTMLElement | null>): (node: HTMLElement | null) => void {
  const [dock, setDock] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const host = board.current;
    if (!host) return undefined;

    if (!dock) {
      // Presentation mode: no prompt, so nothing is reserved.
      host.style.setProperty('--composer-space', '0px');
      return () => host.style.removeProperty('--composer-space');
    }

    const publish = () => {
      const boardBox = host.getBoundingClientRect();
      const dockBox = dock.getBoundingClientRect();
      host.style.setProperty('--composer-space', `${Math.max(0, Math.round(boardBox.bottom - dockBox.top))}px`);
    };

    publish();
    if (typeof ResizeObserver === 'undefined') return () => host.style.removeProperty('--composer-space');

    // BOTH boxes: the dock's height changes when a run starts, and the board's
    // changes on rotation and when the Brain sheet opens — either moves the gap.
    const observer = new ResizeObserver(publish);
    observer.observe(dock);
    observer.observe(host);
    return () => {
      observer.disconnect();
      host.style.removeProperty('--composer-space');
    };
  }, [board, dock]);

  return setDock;
}
