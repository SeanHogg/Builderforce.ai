'use client';

import { useMediaQuery } from './useMediaQuery';

/**
 * Is the primary input a finger/stylus rather than a mouse?
 *
 * Deliberately NOT the same question as `useIsMobile`: viewport width says how much room
 * there is, `(pointer: coarse)` says how precisely the user can hit things. A tablet and
 * a touchscreen laptop are wide AND coarse, and it is the coarseness that decides whether
 * a 9px resize handle is reachable or whether a 1px drag threshold turns every tap into a
 * drag. Sizing touch affordances off width gets both of those wrong.
 *
 * Stays reactive because a 2-in-1 genuinely changes its answer when the keyboard folds
 * away. SSR/first-paint behaviour and the missing-`matchMedia` guard come from
 * {@link useMediaQuery}.
 */
export function useCoarsePointer(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
