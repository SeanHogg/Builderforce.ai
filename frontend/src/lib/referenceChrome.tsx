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

import { createContext, useContext, useEffect, useMemo, useState } from 'react';

/** One anchor in the panel's index rail, with its label already localized. */
export interface ReferenceChromeSection {
  /** The `id` of a `<section>` the page renders. */
  id: string;
  label: string;
}

export interface ReferenceChrome {
  title: string;
  sections?: ReferenceChromeSection[];
}

interface ReferenceChromeStore {
  chrome: ReferenceChrome | null;
  publish: (chrome: ReferenceChrome | null) => void;
}

const NOOP_STORE: ReferenceChromeStore = { chrome: null, publish: () => {} };

const ReferenceChromeContext = createContext<ReferenceChromeStore>(NOOP_STORE);

export function ReferenceChromeProvider({ children }: { children: React.ReactNode }) {
  const [chrome, setChrome] = useState<ReferenceChrome | null>(null);
  const value = useMemo<ReferenceChromeStore>(() => ({ chrome, publish: setChrome }), [chrome]);
  return <ReferenceChromeContext.Provider value={value}>{children}</ReferenceChromeContext.Provider>;
}

/** What the panel should call the page it is showing, when the page said so. */
export function useReferenceChrome(): ReferenceChrome | null {
  return useContext(ReferenceChromeContext).chrome;
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
