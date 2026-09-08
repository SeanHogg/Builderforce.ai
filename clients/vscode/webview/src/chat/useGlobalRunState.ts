/**
 * Which chats have a run in flight, ACROSS the whole editor.
 *
 * Runs execute in the extension host and outlive the panel showing them
 * (`hostRunDriver.ts`), so "is something running?" is a question about the store,
 * not about this view — which is why the subscription is keyed on the SET of live
 * runs rather than on their contents. A token streaming into a chat nobody is
 * looking at must not re-render the one they are.
 */

import { useEffect, useState } from 'react';
import { getGlobalRunState, subscribeRunStore, type GlobalRunState } from '@seanhogg/builderforce-brain-embedded';

/** A stable key of the two run lists, so a view only reacts when the SET of live
 *  chats changes — not on every streaming token (which also emits a store change). */
export function runStateKey(s: GlobalRunState): string {
  return `${[...s.running].sort((a, b) => a - b).join(',')}|${[...s.awaiting].sort((a, b) => a - b).join(',')}`;
}

/**
 * Subscribe to which chats are live across the WHOLE store (the agent loop lives
 * module-level, so a run keeps going after you switch chats). Returns a snapshot
 * whose identity only changes when the set of running/awaiting chats changes, so
 * consumers (the dropdown decoration + the host report) don't churn per token.
 */
export function useGlobalRunState(): GlobalRunState {
  const [state, setState] = useState<GlobalRunState>(getGlobalRunState);
  useEffect(() => {
    const recompute = () => {
      const next = getGlobalRunState();
      setState((prev) => (runStateKey(prev) === runStateKey(next) ? prev : next));
    };
    recompute();
    return subscribeRunStore(recompute);
  }, []);
  return state;
}
