'use client';

/**
 * "Show me the product updates" — one panel, many triggers.
 *
 * The version number appears in two places (the marketing/auth footer and the
 * app sidebar's legal menu) and both must open the SAME changelog, on every
 * route. Each of them owning a `<WhatsNewPanel>` gave two panels on any page
 * that renders both, and two independent handlers for the `?whatsnew=1` deep
 * link the release-digest email sends — which is two panels opening at once.
 *
 * So the panel is mounted ONCE app-wide (`ProductUpdatesHost`) and this store is
 * how anything asks for it. A trigger needs no state, no panel and no knowledge
 * of who else can open it.
 */

import { useEffect, useState } from 'react';

let open = false;
const subscribers = new Set<(next: boolean) => void>();

function publish(next: boolean): void {
  open = next;
  subscribers.forEach((fn) => fn(next));
}

/** Open the changelog from anywhere — a version chip, a menu item, a deep link. */
export function openProductUpdates(): void {
  publish(true);
}

export function closeProductUpdates(): void {
  publish(false);
}

/** For the single host that renders the panel. Triggers do not need this. */
export function useProductUpdatesOpen(): boolean {
  const [local, setLocal] = useState(open);
  useEffect(() => {
    subscribers.add(setLocal);
    setLocal(open);
    return () => { subscribers.delete(setLocal); };
  }, []);
  return local;
}
