'use client';

/**
 * What a reference page calls ITSELF when it opens as a panel (PRD 21 §11.4.5).
 *
 * `PUBLIC_DESTINATIONS` names every reference page whose identity is static —
 * `/soc2` is "SOC 2" and always will be, so it is declared once in the registry
 * and `ShellPanel` reads it there. That covers every reference page but one.
 *
 * `/tools/<id>` is a FAMILY of reference pages whose members are declared by the
 * API's diagnostics catalog, not by the frontend. Restating the five tool names
 * in the registry would make the exact mistake the registry exists to prevent —
 * a second list of the same things, free to drift the day a sixth diagnostic
 * ships — and the panel would still have said "Diagnostics" for every one of
 * them, which is the "one name, one row" complaint in reverse.
 *
 * So a page whose title is DATA publishes it, and the panel reads whichever
 * source has one: published first, registry row second, nav group last. The
 * registry stays the single declaration of destinations; the catalog stays the
 * single declaration of tools; neither restates the other.
 *
 * Outside the operator shell (the signed-out marketing render) there is no
 * provider and no panel — publishing is a no-op, so a page does not need to know
 * which shell it is in.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

/** One row of the panel's index rail, with its label already localized. */
export interface ReferenceChromeSection {
  /**
   * The `id` of a `<section>` the page renders — or, on a page that publishes a
   * selector (see {@link usePublishReferenceSelect}), the id of a view.
   */
  id: string;
  label: string;
}

export interface ReferenceChrome {
  title: string;
  sections?: ReferenceChromeSection[];
  /**
   * Which section is showing, on a page whose sections are VIEWS rather than
   * anchors. Its presence is what makes the rail read as a choice.
   */
  activeId?: string;
}

interface ReferenceChromeStore {
  chrome: ReferenceChrome | null;
  publish: (chrome: ReferenceChrome | null) => void;
  /**
   * Non-null when the page's sections are views it switches between rather than
   * anchors to scroll to. The rail calls this instead of following an `#id`.
   */
  select: ((id: string) => void) | null;
  publishSelect: (handler: ((id: string) => void) | null) => void;
}

const NOOP_STORE: ReferenceChromeStore = {
  chrome: null, publish: () => {}, select: null, publishSelect: () => {},
};

const ReferenceChromeContext = createContext<ReferenceChromeStore>(NOOP_STORE);

export function ReferenceChromeProvider({ children }: { children: React.ReactNode }) {
  const [chrome, setChrome] = useState<ReferenceChrome | null>(null);
  // A handler cannot ride in `chrome`: that is serialized to break the
  // publish → re-render → publish cycle, and a function does not survive
  // JSON. So it lives in a ref, and only its PRESENCE is state — the rail needs
  // to re-render when a selector appears, not when the closure is replaced.
  const [hasSelect, setHasSelect] = useState(false);
  const selectRef = useRef<((id: string) => void) | null>(null);

  const publishSelect = useCallback((handler: ((id: string) => void) | null) => {
    selectRef.current = handler;
    setHasSelect(handler != null);
  }, []);
  // Stable identity, always calling the latest closure.
  const select = useCallback((id: string) => { selectRef.current?.(id); }, []);

  const value = useMemo<ReferenceChromeStore>(
    () => ({ chrome, publish: setChrome, select: hasSelect ? select : null, publishSelect }),
    [chrome, hasSelect, publishSelect, select],
  );
  return <ReferenceChromeContext.Provider value={value}>{children}</ReferenceChromeContext.Provider>;
}

/** What the panel should call the page it is showing, when the page said so. */
export function useReferenceChrome(): ReferenceChrome | null {
  return useContext(ReferenceChromeContext).chrome;
}

/** The page's view switcher, when its sections are views rather than anchors. */
export function useReferenceSelect(): ((id: string) => void) | null {
  return useContext(ReferenceChromeContext).select;
}

/**
 * Hand the panel's rail this page's view switcher.
 *
 * A reference page whose structure is a set of TABS — `/embedded`'s
 * capabilities / install / consent — cannot offer an anchor rail: only one of
 * its sections is in the DOM at a time, so `scrollIntoView` has nothing to find.
 * The rail becomes a selector for those pages instead, which is also what the
 * §11.4.5 mockup shows it doing.
 *
 * Published on every render deliberately: the handler closes over the page's
 * current state, and the ref must point at the live closure. The state write
 * behind it is idempotent, so this settles in one pass rather than looping.
 */
export function usePublishReferenceSelect(handler: ((id: string) => void) | null): void {
  const { publishSelect } = useContext(ReferenceChromeContext);
  useEffect(() => { publishSelect(handler); });
  useEffect(() => () => publishSelect(null), [publishSelect]);
}

/**
 * Declare this page's panel identity. Pass `null` while the title is still
 * loading — the panel then falls back to the registry row rather than flashing
 * an empty header.
 *
 * The effect keys on the SERIALIZED chrome rather than on the object, because a
 * page rebuilds this literal every render and an object identity in the deps
 * would publish → re-render → publish forever.
 */
export function usePublishReferenceChrome(chrome: ReferenceChrome | null): void {
  const { publish } = useContext(ReferenceChromeContext);
  const serialized = chrome ? JSON.stringify(chrome) : '';
  useEffect(() => {
    publish(serialized ? (JSON.parse(serialized) as ReferenceChrome) : null);
    return () => publish(null);
  }, [publish, serialized]);
}
