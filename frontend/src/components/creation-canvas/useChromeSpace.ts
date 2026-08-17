/*
 * No `'use client'`. The hook this replaced carried one, and it bought nothing: this module
 * is imported only by `CreationCanvas.tsx`, which already declares the boundary, so the
 * directive marked an entry point that does not exist and spent a slot in the architecture
 * ratchet's client-file tally. Same reasoning `CanvasAppSurface` and `CanvasSiteSurface`
 * state in their own headers.
 */
import { useEffect, useState } from 'react';
import { observeResizeOnAnimationFrame } from '@/lib/observeResize';

/**
 * Publish the band a piece of FLOATING CHROME actually owns, as a CSS variable on the
 * element everything else is positioned against.
 *
 * ── WHY MEASURED AND NOT DECLARED ────────────────────────────────────────────────
 * The canvas has no chrome band: the board takes the whole shell and every control floats
 * over it. Anything drawn full-bleed underneath — the conversation, an object surface, the
 * running app — therefore has to know how much of its own top and bottom edge is spoken
 * for, and it reads that from a variable.
 *
 * Every one of those bands started as a LITERAL, and every one of them was wrong:
 * `--composer-space` was `112px`, a guess at the prompt's height; `--canvas-command-bar-
 * space` was `66px`, a guess at the bar's. Neither element has a fixed height. The prompt
 * grows by the utilities row the moment a run starts ("Thought for 2s"), by a wrapped
 * scope chip and by a multi-line prompt; the bar grows by whatever the SURFACE contributed
 * to it — the App surface's Run, its three readings and its width switcher — and by the
 * roster and the team band.
 *
 * Each guess produced the same class of bug from the same cause. Forty pixels short on the
 * prompt put the execution chip on top of the phone's command rail. Forty short on the bar
 * put the bar on top of the prompt, so the App surface's own toolbar covered the box you
 * type into. And with nothing reserved at the TOP at all, the conversation surface drew
 * its own header underneath the floating session pill, so the session's name was painted
 * over by the same session's name.
 *
 * So each band is MEASURED, by one hook. The distance from the host's own edge to the
 * measured element's facing edge is the whole answer and needs no knowledge of the
 * element's offset, which differs by breakpoint (16px desktop, 8px phone) — reading the
 * offset would just be the same guess in a second place.
 *
 * ── WHY IT RETURNS A CALLBACK REF ────────────────────────────────────────────────
 * It is state-backed rather than a `useRef`, because the measured element unmounts — the
 * prompt in presentation mode, or when it is closed, or when it moves INTO the Brain panel
 * and stops being the board's chrome at all — and a plain ref cannot tell the effect that
 * it has. State re-runs the effect, which publishes `0px` so everything reclaims the space
 * instead of avoiding an element that is gone.
 *
 * @param host      the element the variable is published on, and the edge measured from
 * @param property  the custom property to publish, e.g. `--composer-space`
 * @param options.edge  which of the host's edges the chrome is anchored to (default bottom)
 * @param options.gap   extra pixels to reserve, for content that must CLEAR the chrome
 *                      with visible air rather than touch it
 */
export function useChromeSpace(
  host: React.RefObject<HTMLElement | null>,
  property: string,
  { edge = 'bottom', gap = 0 }: { edge?: 'top' | 'bottom'; gap?: number } = {},
): (node: HTMLElement | null) => void {
  const [measured, setMeasured] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return undefined;

    if (!measured) {
      // Nothing there: nothing reserved.
      element.style.setProperty(property, '0px');
      return () => element.style.removeProperty(property);
    }

    const publish = () => {
      const hostBox = element.getBoundingClientRect();
      const box = measured.getBoundingClientRect();
      const band = edge === 'top' ? box.bottom - hostBox.top : hostBox.bottom - box.top;
      element.style.setProperty(property, `${Math.max(0, Math.round(band) + gap)}px`);
    };

    publish();
    if (typeof ResizeObserver === 'undefined') return () => element.style.removeProperty(property);

    // BOTH boxes: the measured element's height changes when a run starts or a surface
    // contributes its controls, and the host's changes on rotation and when a panel
    // opens — either moves the gap.
    const disconnectResize = observeResizeOnAnimationFrame([measured, element], publish);
    return () => {
      disconnectResize();
      element.style.removeProperty(property);
    };
  }, [edge, gap, host, measured, property]);

  return setMeasured;
}
