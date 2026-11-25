// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useCallback, useEffect, useState } from 'react';
import { listBoardMediaIssues, type BoardMediaIssue } from '@/domains/canvas/infrastructure/localFirst/mediaUploadStatus';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { getStudioRuntime } from '@/lib/localFirst/studioRuntime';

/**
 * The uploads of one board that failed or are backing off (`mediaUploadStatus`), following the store
 * the way `useBoardConflicts` does, and the person's retry of a failed one.
 */
export function useBoardMediaIssues(boardId: string, enabled: boolean): { issues: BoardMediaIssue[]; retry: (mediaId: string) => Promise<void> } {
  const [issues, setIssues] = useState<BoardMediaIssue[]>([]);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    let timer: number | undefined;
    void getStudioRuntime().then((runtime) => {
      if (cancelled || !runtime) return;
      const load = (): void => {
        void listBoardMediaIssues(runtime.store, boardId)
          .then((open) => { if (!cancelled) setIssues(open); })
          .catch((error: unknown) => reportLocalFirstFailure('useBoardMediaIssues.list', error));
      };
      load();
      unsubscribe = runtime.store.subscribe(() => {
        window.clearTimeout(timer);
        timer = window.setTimeout(load, 150);
      });
    });
    return () => { cancelled = true; window.clearTimeout(timer); unsubscribe?.(); };
  }, [boardId, enabled]);

  const retry = useCallback(async (mediaId: string): Promise<void> => {
    const runtime = await getStudioRuntime();
    if (!runtime) return;
    try {
      await runtime.queue.retry(mediaId);
    } catch (error) {
      // Reported here, once; the item stays `failed` and listed, so the person can retry again.
      reportLocalFirstFailure('useBoardMediaIssues.retry', error);
    }
  }, []);

  return { issues, retry };
}
