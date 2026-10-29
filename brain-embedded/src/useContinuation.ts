'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { BrainPersistenceAdapter } from './config';
import { getRunDriver } from './runDriver';
import { continueOnSettle, releaseContinuation } from './runStore/continueChat';
import type { BrainRunRequest } from './runStore/runTypes';

/**
 * Opts the runs a conversation launches into continuing themselves (`runStore/continueChat.ts`):
 * direction a run never reads becomes THAT chat's next turn, whichever chat is on screen.
 *
 * Returns `bind(chatId)`, called at each launch. The binding reads the conversation's NEWEST
 * persistence and `prepareRun` at the time it is used (a ref, not a capture), and is released when
 * the conversation unmounts - nothing is left to compose words for a view that is gone.
 * Only where the run executes HERE: a host-driven run (the editor's webview) settles elsewhere,
 * and its host wakes its own.
 */
export function useContinuation(
  persistence: BrainPersistenceAdapter,
  prepareRun: ((chatId: number) => Promise<Partial<BrainRunRequest>>) | undefined,
): (chatId: number) => void {
  const latest = useRef({ persistence, prepareRun });
  // eslint-disable-next-line react-hooks/refs
  latest.current = { persistence, prepareRun };
  const bound = useRef(new Set<number>());
  useEffect(() => {
    const ids = bound.current;
    return () => {
      for (const id of ids) releaseContinuation(id);
      ids.clear();
    };
  }, []);
  return useCallback((chatId: number) => {
    if (getRunDriver()) return;
    bound.current.add(chatId);
    continueOnSettle(chatId, {
      ports: () => latest.current.persistence,
      prepareRun: (id) => (latest.current.prepareRun ? latest.current.prepareRun(id) : Promise.resolve({})),
    });
  }, []);
}
