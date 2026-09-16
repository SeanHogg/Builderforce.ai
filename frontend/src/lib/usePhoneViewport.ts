import { useMediaQuery } from './useMediaQuery';

/**
 * The ONE phone-width question in JavaScript, and the number it asks with.
 *
 * ── WHY IT IS 767 AND NOT 760 ────────────────────────────────────────────────────
 * The canvas's own chrome was written against `@media (max-width: 760px)` while the
 * persistent `MobileBottomNav` and `--mobile-nav-height` are `max-width: 767px`. The
 * seven pixels between them were a real layout: 761–767px got the bottom nav AND the
 * desktop canvas, so the command bar and the nav shared the same strip of screen.
 * One number, here and in `CreationCanvas.module.css`, is what closes that band.
 *
 * ── WHY A HOOK AND NOT A CSS CLASS ───────────────────────────────────────────────
 * Almost everything about the phone canvas IS a CSS rule and must stay one. Two
 * decisions cannot be: which host renders the board menu (drawing it in both the
 * command bar and the phone app bar would put two of the same sheet in one document,
 * not one hidden copy), and which intent the composer arms when the Brain sheet opens
 * (that is state, and `display:none` cannot change state). Those two ask here.
 *
 * SSR/first-paint behaviour and the missing-`matchMedia` guard come from
 * {@link useMediaQuery}: `false` until mount, and `false` in jsdom — which is the
 * honest answer for a test that has no viewport, and the reason the desktop
 * arrangement is the one a test sees.
 *
 * No `'use client'`: every caller sits inside a client boundary already, the same
 * reason `useChromeSpace` gives in its own header.
 */
export const PHONE_VIEWPORT_MAX_WIDTH = 767;

export function usePhoneViewport(): boolean {
  return useMediaQuery(`(max-width: ${PHONE_VIEWPORT_MAX_WIDTH}px)`);
}
