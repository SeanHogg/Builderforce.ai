/**
 * "This page already shows the Brain inline."
 *
 * The app-wide floating launcher opens a drawer hosting the SAME `<BrainPanel>` a page
 * may already dock in its own layout (the Studio / IDE left column, a project's details
 * panel). Showing both put two entry points to one conversation on screen — the corner
 * button just opened a second copy of the chat sitting beside it. An inline Brain
 * registers here while mounted; the launcher reads it and stands down.
 *
 * A counter, not a flag: two inline hosts can be mounted at once, and the launcher must
 * stay hidden until the LAST one unmounts. Module state (not React context) because the
 * launcher and the inline hosts sit in different subtrees, and the Brain context itself
 * ships from a published package this concern does not belong in.
 */

import { useEffect, useSyncExternalStore } from 'react';

let mounted = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const snapshot = () => mounted > 0;
const serverSnapshot = () => false;

/** Register an inline Brain for as long as `active` is true and the caller is mounted. */
export function useRegisterInlineBrain(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    mounted += 1;
    emit();
    return () => {
      mounted -= 1;
      emit();
    };
  }, [active]);
}

/** True while any page shows the Brain inline. */
export function useInlineBrainMounted(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
