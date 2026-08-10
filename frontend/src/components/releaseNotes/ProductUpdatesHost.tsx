'use client';

/**
 * The single app-wide mount of the Product Updates panel, plus the one handler
 * for the `?whatsnew=1` deep link the weekly release-digest email links to.
 *
 * Mounted beside the other always-on chrome so the changelog is reachable from
 * every route — including the in-app shell, which has no footer and so had no
 * way to the changelog at all. Triggers call `openProductUpdates()`; nobody else
 * renders the panel.
 *
 * The deep link is read from `window.location` rather than `useSearchParams()`
 * on purpose: it arrives on a full page load from an email, and reading it here
 * keeps every route that mounts this host out of forced dynamic rendering.
 */

import { useEffect } from 'react';
import WhatsNewPanel from '@/components/WhatsNewPanel';
import { closeProductUpdates, openProductUpdates, useProductUpdatesOpen } from '@/lib/productUpdates';

export function ProductUpdatesHost() {
  const open = useProductUpdatesOpen();

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('whatsnew') === '1') openProductUpdates();
  }, []);

  return <WhatsNewPanel open={open} onClose={closeProductUpdates} />;
}
