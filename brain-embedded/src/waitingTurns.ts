'use client';

import { useSyncExternalStore } from 'react';
import type { RunKey } from './brainRunStore';
import { removeWaiting, subscribeWaiting, waitingFor, waitingVersion } from './chatDelivery';
import type { QueuedItem, QueuedTurns } from './useQueuedTurns';

/**
 * The turns waiting for a chat's run (`chatDelivery.ts`: typed while a draft created the chat) belong in that chat's queue, in
 * front of whatever the queue holds - they were typed first. This is the queue the door shows: the chat's own held turns behind
 * the waiting ones, counted and removable together. A waiting turn's id is negative (never one the queue itself holds), which is
 * how `remove` tells whose it is.
 */
export function useQueueWithWaiting<T>(queued: QueuedTurns<T>, runKey: RunKey | null): QueuedTurns<T> {
  useSyncExternalStore(subscribeWaiting, waitingVersion, waitingVersion);
  const waiting: readonly QueuedItem<T>[] = typeof runKey === 'number'
    ? waitingFor(runKey).map((turn) => ({ id: turn.id, value: (turn.turn ?? turn.text) as T }))
    : [];
  if (waiting.length === 0) return queued;
  return {
    ...queued,
    items: [...waiting, ...queued.items],
    count: waiting.length + queued.count,
    remove: (id: number) => (id < 0 ? removeWaiting(id) : queued.remove(id)),
  };
}
