'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { BrainPersistenceAdapter } from './config';
import { getRunDriver } from './runDriver';
import { continueOnSettle, releaseContinuation, type ContinueBinding } from './runStore/continueChat';
import type { BrainRunRequest } from './runStore/runTypes';

/**
 * Opts the runs a conversation launches into continuing themselves (`runStore/continueChat.ts`):
 * direction a run never reads becomes THAT chat's next turn, whichever chat is on screen.
 *
 * Returns `bind(chatId)`, called at each launch. The binding reads the conversation's NEWEST
 * persistence and `prepareRun` at the time it is used (a ref, not a capture), and is released when
 * the conversation unmounts - only the bindings THIS conversation made, so a newer conversation over
 * the same chat keeps its own. Only where the run executes HERE: a host-driven run (the editor's
 * webview) settles elsewhere, and its host wakes its own.
 */
export function useContinuation(
  persistence: BrainPersistenceAdapter,
  prepareRun: ((chatId: number) => Promise<Partial<BrainRunRequest>>) | undefined,
): (chatId: number) => void {
  const latest = useRef({ persistence, prepareRun });
  // eslint-disable-next-line react-hooks/refs
  latest.current = { persistence, prepareRun };
  const bound = useRef(new Map<number, ContinueBinding>());
  useEffect(() => {
    const mine = bound.current;
    return () => {
      for (const [chatId, binding] of mine) releaseContinuation(chatId, binding);
      mine.clear();
    };
  }, []);
  return useCallback((chatId: number) => {
    if (getRunDriver()) return;
    const binding: ContinueBinding = {
      ports: () => latest.current.persistence,
      prepareRun: (id) => (latest.current.prepareRun ? latest.current.prepareRun(id) : Promise.resolve({})),
    };
    bound.current.set(chatId, binding);
    continueOnSettle(chatId, binding);
  }, []);
}
