'use client';

/**
 * webcontainerSession — THE one WebContainer boot for a page, and the record that
 * it happened.
 *
 * A page may hold exactly one WebContainer: a second `WebContainer.boot()` throws
 * "Unable to create more instances". The IDE hook (`useWebContainer`) and the agent
 * worker's build step (`browserRuntime/factory`) used to boot independently, so
 * whichever ran second failed. Both now share this singleton.
 *
 * It is also the licensing seam. Free-tier WebContainer use is granted for
 * non-commercial use WITH ATTRIBUTION, up to 25,000 API sessions a month. A boot is
 * a session, so this module is where a session is observed: the attribution
 * (`components/webcontainer/WebContainerAttribution`) subscribes here and appears
 * on any page that actually booted one, rather than each surface remembering to.
 */
import { useSyncExternalStore } from 'react';
import type { WebContainer } from '@webcontainer/api';

let instance: WebContainer | null = null;
let booting: Promise<WebContainer> | null = null;
let booted = false;
const listeners = new Set<() => void>();

function markBooted(): void {
  if (booted) return;
  booted = true;
  for (const listener of listeners) listener();
}

/** Boot the page's WebContainer, or return the one already running. */
export async function bootSharedWebContainer(): Promise<WebContainer> {
  if (instance) return instance;
  if (booting) return booting;

  const g = globalThis as { crossOriginIsolated?: boolean };
  if ('crossOriginIsolated' in g && g.crossOriginIsolated === false) {
    throw new Error('WebContainer requires cross-origin isolation (COOP/COEP headers).');
  }

  booting = import('@webcontainer/api').then(({ WebContainer: WC }) => WC.boot());
  try {
    instance = await booting;
    markBooted();
    return instance;
  } finally {
    booting = null;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** True once this page has booted a WebContainer (attribution is then owed). */
export function useWebContainerBooted(): boolean {
  return useSyncExternalStore(subscribe, () => booted, () => false);
}
