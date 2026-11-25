// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useEffect, useState } from 'react';
import { getStudioRuntime } from './studioRuntime';
import type { WebSyncStatus } from './webSyncDriver';

/**
 * The Studio sync driver's status, live — `undefined` until the runtime has booted (and for good where
 * the browser cannot hold the store durably). The driver is shared: this reads it, it does not start one.
 */
export function useStudioSyncStatus(): WebSyncStatus | undefined {
  const [status, setStatus] = useState<WebSyncStatus | undefined>(undefined);
  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void getStudioRuntime().then((runtime) => {
      if (cancelled || !runtime) return;
      setStatus(runtime.driver.status());
      unsubscribe = runtime.driver.subscribe(setStatus);
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  return status;
}
