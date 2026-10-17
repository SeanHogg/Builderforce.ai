'use client';

import { useEffect, useState } from 'react';
import { getRunSnapshot, subscribeRun } from './brainRunStore';
import type { BrainRunSnapshot, RunKey } from './brainRunStore';

/**
 * The live snapshot of one run cell — the binding `useBrainConversation` makes for a
 * chat, for a run keyed any way (`startEngineRun`'s canvas turns). Re-subscribes when
 * the key changes; reads the current snapshot on (re)subscribe so a run that started
 * before the view mounted is shown at once.
 */
export function useRunSnapshot(key: RunKey | null): BrainRunSnapshot {
  const [snapshot, setSnapshot] = useState(() => getRunSnapshot(key));
  useEffect(() => {
    setSnapshot(getRunSnapshot(key));
    if (key == null) return undefined;
    return subscribeRun(key, () => setSnapshot(getRunSnapshot(key)));
  }, [key]);
  return snapshot;
}
