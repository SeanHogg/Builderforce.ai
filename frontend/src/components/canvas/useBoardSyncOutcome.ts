// No `'use client'`: this module exports a hook, not a component, so a directive marks no boundary.

import { useEffect, useRef, useState } from 'react';
import { isBoardAccepted, isBoardPlanLimited } from '@/domains/canvas/infrastructure/localFirst/boardSyncOutcome';
import { reportLocalFirstFailure } from '@/lib/localFirst/reportLocalFirstFailure';
import { getStudioRuntime, studioDestination } from '@/lib/localFirst/studioRuntime';

/**
 * What the server has said about the board on screen, from the store (design §7).
 *
 * `onAccepted` fires ONCE, the first time the board has a server mapping — the moment "what I was
 * working on" may point at it. `planLimited` is true while the workspace's plan refused the board's
 * creation and nothing has been accepted since: the surface shows the upgrade UI from it.
 */
export function useBoardSyncOutcome(boardId: string, enabled: boolean, onAccepted: (boardId: string) => void): { planLimited: boolean } {
  const [planLimited, setPlanLimited] = useState(false);
  const acceptedRef = useRef(onAccepted);
  useEffect(() => { acceptedRef.current = onAccepted; });

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    let announced = false;
    let unsubscribe: (() => void) | undefined;
    const check = async (store: NonNullable<Awaited<ReturnType<typeof getStudioRuntime>>>['store'], refused: boolean): Promise<void> => {
      const destination = studioDestination();
      if (destination.kind !== 'bound') return;
      const accepted = await isBoardAccepted(store, boardId, destination);
      if (cancelled) return;
      if (accepted && !announced) { announced = true; acceptedRef.current(boardId); }
      // Receipts are read only when a round actually refused something (or on the first look): the
      // export behind them is not a cost to pay on every status publish.
      if (accepted) setPlanLimited(false);
      else if (refused) setPlanLimited(await isBoardPlanLimited(store, boardId, destination));
    };
    void getStudioRuntime().then((runtime) => {
      if (cancelled || !runtime) return;
      const run = (refused: boolean): void => { void check(runtime.store, refused).catch((error: unknown) => reportLocalFirstFailure('useBoardSyncOutcome', error)); };
      run(true);
      unsubscribe = runtime.driver.subscribe((status) => run((status.lastSummary?.rejected ?? 0) > 0));
    });
    return () => { cancelled = true; unsubscribe?.(); };
  }, [boardId, enabled]);

  return { planLimited };
}
