import { PHONE_VIEWPORT_MAX_WIDTH } from '@/lib/usePhoneViewport';

/**
 * THE ONE matchMedia stub for phone-width tests.
 *
 * `usePhoneViewport` → `useMediaQuery` answers `false` in jsdom (no `matchMedia`,
 * and `false` until mount by design). That is the honest default, and it is why
 * every canvas test used to see only the desktop chrome. Tests that need the
 * phone arrangement install this helper — not a per-file mock — so the next
 * phone test cannot invent a second one.
 *
 * `useMediaQuery` still paints one frame of `false` after mount, so assertions
 * that the phone chrome is on screen must `waitFor` it. Restoring in `afterEach`
 * is the caller's job; leaving the stub in place would make a later desktop
 * test in the same file see a phone.
 */

export { PHONE_VIEWPORT_MAX_WIDTH };

export interface PhoneViewportHandle {
  /** Drive the stubbed viewport to a new CSS-px width and notify subscribers. */
  setWidth: (width: number) => void;
  /** Put `window.matchMedia` back the way it was. */
  restore: () => void;
}

function parsePx(query: string, bound: 'max-width' | 'min-width'): number | null {
  const match = new RegExp(`\\(\\s*${bound}:\\s*(\\d+(?:\\.\\d+)?)px\\s*\\)`).exec(query);
  return match ? Number(match[1]) : null;
}

function queryMatches(query: string, width: number): boolean {
  const max = parsePx(query, 'max-width');
  if (max != null) return width <= max;
  const min = parsePx(query, 'min-width');
  if (min != null) return width >= min;
  return false;
}

export function installMatchMedia(initialWidth: number): PhoneViewportHandle {
  const original = typeof window.matchMedia === 'function'
    ? window.matchMedia.bind(window)
    : undefined;

  let width = initialWidth;
  const lists = new Set<{ media: string; notify: () => void }>();

  window.matchMedia = (query: string) => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const list = {
      get matches() { return queryMatches(query, width); },
      media: query,
      onchange: null as ((this: MediaQueryList, ev: MediaQueryListEvent) => void) | null,
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type !== 'change' || typeof listener !== 'function') return;
        listeners.add(listener as (event: MediaQueryListEvent) => void);
      },
      removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (typeof listener !== 'function') return;
        listeners.delete(listener as (event: MediaQueryListEvent) => void);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => { listeners.add(listener); },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => { listeners.delete(listener); },
      dispatchEvent: () => false,
      notify() {
        const event = { matches: queryMatches(query, width), media: query } as MediaQueryListEvent;
        for (const listener of listeners) listener(event);
        list.onchange?.(event);
      },
    };
    lists.add(list);
    return list as MediaQueryList;
  };

  return {
    setWidth(next) {
      width = next;
      for (const list of lists) list.notify();
    },
    restore() {
      if (original) window.matchMedia = original;
      else delete (window as { matchMedia?: typeof window.matchMedia }).matchMedia;
    },
  };
}

/** Phone-width default used by the artboard (390×844). */
export function installPhoneViewport(width = 390): PhoneViewportHandle {
  return installMatchMedia(width);
}
