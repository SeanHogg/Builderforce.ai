import type { RefObject } from 'react';
import { useChromeSpace } from '../useChromeSpace';

/** The air between the command bar and the prompt floating above it. The bar's HEIGHT is
 *  measured (see `useChromeSpace`); this is the only part of that band a number can
 *  honestly state, because it is a spacing decision rather than a fact about an element. */
const COMMAND_BAR_CLEARANCE = 10;
/** The air between the floating TOP chrome and anything drawn under it — the panels that
 *  open in the top-right corner, and every full-bleed surface. Same reasoning as
 *  `COMMAND_BAR_CLEARANCE`, at the other edge. */
const TOP_CHROME_CLEARANCE = 8;

/**
 * The three bands the canvas's floating chrome owns, each MEASURED and published as a CSS
 * variable — never declared as a literal, because none of the three elements has a fixed
 * height (see `useChromeSpace`). Each returned ref goes on the element that owns the band.
 */
export function useCanvasChromeBands({ boardRef, shellRef }: {
  boardRef: RefObject<HTMLElement | null>;
  shellRef: RefObject<HTMLElement | null>;
}) {
  // The prompt's real height, published to the board as `--composer-space` — the band
  // every bottom-anchored panel and the phone command rail sit above.
  const composerDockRef = useChromeSpace(boardRef, '--composer-space');
  // The command bar's real height, published to the SHELL as `--canvas-command-bar-space`
  // — the band the floating prompt sits above. The bar grows by whatever the SURFACE
  // contributes to it (the App surface's Run, its readings, its width switcher).
  const commandBarSpaceRef = useChromeSpace(shellRef, '--canvas-command-bar-space', { gap: COMMAND_BAR_CLEARANCE });
  // The band the floating chrome owns at the TOP of the shell, measured off the fused
  // phase/surface card — the taller of the two cards sharing that line. Every FULL-BLEED
  // surface draws from the shell's top edge and reads it, and so does a panel anchored to
  // that edge; the widget grows by a row when a surface is added and changes with phase.
  const topChromeSpaceRef = useChromeSpace(shellRef, '--canvas-top-chrome-space', { edge: 'top', gap: TOP_CHROME_CLEARANCE });
  return { composerDockRef, commandBarSpaceRef, topChromeSpaceRef };
}
