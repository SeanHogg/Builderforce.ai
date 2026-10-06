/**
 * "This project's site was just published."
 *
 * The first publish is what creates a project's site — and with it the tables
 * and sign-ins the Database view shows. That view sits beside the Publish panel,
 * so without a signal it would keep saying "publish first" after the publish
 * finished. `publishSite` is the one place that announces it, so every publish
 * surface is covered. A notification, not a store: listeners re-read.
 *
 * The published site rides along, so a listener that only needs the address (the canvas
 * recording a deployment card, `useRecordAppDeployments`) does not re-fetch it.
 */

import type { SitePublishResult } from './api';
import { reportBackgroundFailure } from './reportError';

type Listener = (projectId: number, site: SitePublishResult) => void;

const listeners = new Set<Listener>();

export function notifySitePublished(projectId: number, site: SitePublishResult): void {
  for (const listener of listeners) {
    try {
      listener(projectId, site);
    } catch (cause) {
      // A bad subscriber must never fail the publish that triggered it — but it is a bug, so it is reported.
      void reportBackgroundFailure({ message: `site-published listener failed: ${String(cause)}`, level: 'warning' });
    }
  }
}

/** Subscribe to publishes. Returns the unsubscribe. */
export function subscribeSitePublished(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
