'use client';

import { useMediaQuery } from './useMediaQuery';

/**
 * Reactive "is this a narrow (mobile) viewport?" flag for the many surfaces that are laid
 * out with inline styles and so cannot reach for a CSS `@media` block. Matches the repo's
 * CSS breakpoint (`@media (max-width: 640px)`) by default so JS-driven and CSS-driven
 * responsiveness agree.
 *
 * Width only — for "can the user hit a 9px target", ask `useCoarsePointer` instead.
 * SSR/first-paint behaviour and the missing-`matchMedia` guard come from
 * {@link useMediaQuery}.
 */
export function useIsMobile(maxWidth = 640): boolean {
  return useMediaQuery(`(max-width: ${maxWidth}px)`);
}
