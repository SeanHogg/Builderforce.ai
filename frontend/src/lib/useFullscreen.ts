import { useCallback, useEffect, useState, type RefObject } from 'react';

/**
 * Full screen for one element, and the state of whether it currently is.
 *
 * ── WHY A HOOK AND NOT `requestFullscreen()` AT THE CALL SITE ─────────────
 * Two surfaces run a game (the play runtime and the 3D space), and both need
 * the same three things: the request, the exit, and a LABEL that tells the
 * truth after the user leaves full screen with Escape — which fires no click
 * and would otherwise leave a button reading "Exit full screen" over a window
 * that is not. The listener is the part call sites forget, so it lives here.
 *
 * `document.fullscreenElement` is the single source of the state; the hook
 * never keeps its own boolean in step with the browser's, it reads the
 * browser's. WebKit's prefixed API is included because iPad Safari still ships
 * it, and a game that cannot go full screen on a tablet is the case this
 * exists for.
 */

interface WebkitFullscreen {
  webkitRequestFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitFullscreenElement?: Element | null;
}

function fullscreenElement(): Element | null {
  if (typeof document === 'undefined') return null;
  const legacy = document as Document & WebkitFullscreen;
  return document.fullscreenElement ?? legacy.webkitFullscreenElement ?? null;
}

export interface FullscreenControl {
  /** Whether THIS element is the one filling the screen. */
  active: boolean;
  /** Whether the browser offers full screen at all — false in an iframe
   *  without `allow="fullscreen"`, where the button must not be drawn. */
  available: boolean;
  toggle: () => void;
}

export function useFullscreen(ref: RefObject<HTMLElement | null>): FullscreenControl {
  const [active, setActive] = useState(false);
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    const element = ref.current;
    const legacy = element as (HTMLElement & WebkitFullscreen) | null;
    setAvailable(Boolean(
      element
      && (typeof element.requestFullscreen === 'function' || typeof legacy?.webkitRequestFullscreen === 'function')
      && (typeof document.exitFullscreen === 'function' || typeof (document as Document & WebkitFullscreen).webkitExitFullscreen === 'function'),
    ));
  }, [ref]);

  useEffect(() => {
    const sync = () => setActive(Boolean(ref.current && fullscreenElement() === ref.current));
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync);
    };
  }, [ref]);

  const toggle = useCallback(() => {
    const element = ref.current;
    if (!element) return;
    const legacyDocument = document as Document & WebkitFullscreen;
    if (fullscreenElement() === element) {
      // Rejections are ignored on purpose: the user asked to leave a mode they
      // are already leaving, and there is nothing useful to say about it.
      void Promise.resolve(document.exitFullscreen?.() ?? legacyDocument.webkitExitFullscreen?.()).catch(() => {});
      return;
    }
    const legacyElement = element as HTMLElement & WebkitFullscreen;
    void Promise.resolve(element.requestFullscreen?.() ?? legacyElement.webkitRequestFullscreen?.()).catch(() => {});
  }, [ref]);

  return { active, available, toggle };
}
