// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useCallback, useEffect, useState } from 'react';
import type { SyncConflict } from '@builderforce/local-first';
import { listBoardConflicts, resolveBoardConflict, type ConflictChoice } from '@/domains/canvas/infrastructure/localFirst/boardConflicts';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { getStudioRuntime } from '@/lib/localFirst/studioRuntime';

/**
 * The unresolved conflicts of one board — two writers touched the same object — and the three ways a
 * person settles them (`boardConflicts`). The list follows the store (another tab, a sync round) and a
 * settlement re-sends what it decided, so the driver is nudged after each one.
 */
export function useBoardConflicts(boardId: string, enabled: boolean): { conflicts: SyncConflict[]; resolve: (conflictId: string, choice: ConflictChoice) => Promise<void> } {
  const [conflicts, setConflicts] = useState<SyncConflict[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: number | undefined;
    void getStudioRuntime().then((runtime) => {
      if (cancelled || !runtime) return;
      const load = (): void => {
        void listBoardConflicts(runtime.store, boardId)
          .then((open) => { if (!cancelled) setConflicts(open); })
          .catch((error: unknown) => reportLocalFirstFailure('useBoardConflicts.list', error));
      };
      load();
      unsubscribe = runtime.store.subscribe(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(load, 150);
      });
    });
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [boardId, enabled]);

  const resolve = useCallback(async (conflictId: string, choice: ConflictChoice): Promise<void> => {
    const runtime = await getStudioRuntime();
    if (!runtime) return;
    try {
      await resolveBoardConflict({ store: runtime.store, deviceId: runtime.deviceId }, conflictId, choice);
      runtime.driver.trigger();
    } catch (error) {
      reportLocalFirstFailure('useBoardConflicts.resolve', error);
      throw error;
    }
  }, []);

  return { conflicts, resolve };
}
