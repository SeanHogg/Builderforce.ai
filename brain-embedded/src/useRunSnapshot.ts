'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { getRunSnapshot, subscribeRun } from './brainRunStore';
import type { BrainRunSnapshot, RunKey } from './brainRunStore';

/**
 * The live snapshot of one run cell — the binding `useBrainConversation` makes for a
 * chat, and every other view of a run keyed any way (a sub-agent's cell,
 * `startEngineRun`'s canvas turns).
 *
 * Read through `useSyncExternalStore`, so the snapshot returned is ALWAYS the cell named
 * by `key` in this render. The earlier state-plus-effect binding returned the PREVIOUS
 * key's snapshot for the first render after a switch — a panel that walked from one
 * running chat to another briefly reported the old chat's run as the new one's. The
 * store hands out a stable snapshot identity until the cell changes, which is what
 * `useSyncExternalStore` requires.
 */
export function useRunSnapshot(key: RunKey | null): BrainRunSnapshot {
  const subscribe = useCallback(
    (onChange: () => void) => (key == null ? () => undefined : subscribeRun(key, onChange)),
    [key],
  );
  const read = () => getRunSnapshot(key);
  return useSyncExternalStore(subscribe, read, read);
}
