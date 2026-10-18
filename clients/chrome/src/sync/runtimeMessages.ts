/**
 * The messages the side panel sends the service worker — the ONE channel between the
 * run host (panel) and the owner of every network write (worker). Typed here so both
 * ends agree, and so a message from anywhere else (a page, another extension) is
 * recognisably not one of ours.
 */
import type { SyncItem } from './chatSync';
import type { ClientErrorEvent } from '../telemetry/errorEvents';

export type RovrRuntimeMessage =
  | { type: 'rovr.sync.enqueue'; chatId: number; items: SyncItem[] }
  | { type: 'rovr.sync.flush' }
  | { type: 'rovr.sync.stats' }
  | { type: 'rovr.error.report'; event: ClientErrorEvent };

export interface SyncStats {
  queued: number;
  inFlight: number;
  dropped: number;
}

const TYPES = new Set<RovrRuntimeMessage['type']>(['rovr.sync.enqueue', 'rovr.sync.flush', 'rovr.sync.stats', 'rovr.error.report']);

export function isRovrRuntimeMessage(value: unknown): value is RovrRuntimeMessage {
  return !!value && typeof value === 'object' && TYPES.has((value as { type?: RovrRuntimeMessage['type'] }).type!);
}

/**
 * The worker's one message the OTHER way: the sync queue changed, with its new stats.
 * Broadcast on every change of the outbox (`ChatSync.subscribe`) so an open panel shows
 * what is waiting to sync without polling; nobody listening (panel closed) is fine.
 */
export interface SyncStatsChanged {
  type: 'rovr.sync.changed';
  stats: SyncStats;
}

export function isSyncStatsChanged(value: unknown): value is SyncStatsChanged {
  return !!value && typeof value === 'object' && (value as { type?: unknown }).type === 'rovr.sync.changed';
}

/** Hear the worker's {@link SyncStatsChanged} broadcasts (extension pages only); returns an unsubscribe. */
export function onSyncStatsChanged(listener: (stats: SyncStats) => void): () => void {
  const handle = (message: unknown, sender: chrome.runtime.MessageSender): void => {
    if (sender.id === chrome.runtime.id && !sender.tab && isSyncStatsChanged(message)) listener(message.stats);
  };
  chrome.runtime.onMessage.addListener(handle);
  return () => chrome.runtime.onMessage.removeListener(handle);
}

/** Where the panel hands a write for the platform — the worker, over `chrome.runtime`. */
export interface SyncSink {
  enqueue(chatId: number, items: SyncItem[]): void;
}

/** Hand-off attempts before giving up on waking the worker (it starts in milliseconds). */
const HANDOFF_ATTEMPTS = 5;

/**
 * The panel's {@link SyncSink}: hand the write to the worker, which wakes to take it and
 * acknowledges once it is in the durable outbox. Retried with backoff until acknowledged
 * — the local record already holds the write, so this never blocks the run.
 */
export function runtimeSyncSink(
  send: (message: RovrRuntimeMessage) => Promise<unknown>,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): SyncSink {
  return {
    enqueue(chatId, items) {
      if (items.length === 0) return;
      void (async () => {
        for (let attempt = 0; attempt < HANDOFF_ATTEMPTS; attempt++) {
          try {
            if ((await send({ type: 'rovr.sync.enqueue', chatId, items })) === true) return;
          } catch {
            /* the worker was not up yet — try again */
          }
          await sleep(250 * 2 ** attempt);
        }
      })();
    },
  };
}
