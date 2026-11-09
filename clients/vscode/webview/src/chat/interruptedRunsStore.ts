/**
 * The run list's interrupted runs, as the host last sent them (`run.interrupted`).
 *
 * The list is HOST state (`src/interruptedRunsView.ts`): the host re-sends it whole every
 * time a panel attaches (a webview reload included) and after each acknowledgement, so
 * this holds only the last copy. The listener is installed when the module loads, before
 * the host's first frame, so a frame that arrives while History is closed is not lost.
 */

import { useSyncExternalStore } from 'react';
import type { InterruptedRunView } from '../../../src/interruptedRunTypes';
import { onHostMessage, post } from '../vscodeBridge';

export type { InterruptedRunView };

let current: InterruptedRunView[] = [];
const listeners = new Set<() => void>();

onHostMessage<{ runs: InterruptedRunView[] }>('run.interrupted', (m) => {
  current = Array.isArray(m.runs) ? m.runs : [];
  for (const listener of listeners) listener();
});

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export function useInterruptedRuns(): InterruptedRunView[] {
  return useSyncExternalStore(subscribe, () => current);
}

/** Acknowledge an interrupted run: dismissed by the person, or resumed and claimed by its chat. The host journals it and re-sends the list. */
export const acknowledgeInterruptedRun = (runId: string): void => post('run.acknowledgeInterrupted', { runId });
