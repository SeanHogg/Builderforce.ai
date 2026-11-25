// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary (the `domainExtras.tsx` rule).

import { useSyncExternalStore } from 'react';
import { isBrowserOnline } from '@/lib/studio/studioHost';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

/** Whether the browser says it is online; re-renders when that changes. Server rendering counts as online. */
export function useBrowserOnline(): boolean {
  return useSyncExternalStore(subscribe, isBrowserOnline, () => true);
}
