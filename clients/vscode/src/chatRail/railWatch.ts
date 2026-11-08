/**
 * When a store commit is worth re-posting the rail for (G21).
 *
 * - At once (short debounce): a chat-ticket link or a ticket was written, or a run the last posted
 *   rail shows (its run or ticket ids). Which link or ticket belongs to THIS chat is not known
 *   without a read, so any of them counts: a spurious repost costs one local read, a missed one
 *   leaves the rail stale. A run is narrower: local run checkpoints write `execution` rows all the
 *   time, and reposting every open rail on each would be a read per checkpoint per rail. Before
 *   the first post nothing is known, so any run counts.
 * - Once per sync pass (trailing debounce, about a second): the sync state changed (receipts,
 *   mappings, cursors). The rows' sync badges and the header's summary read it, so a rail that
 *   ignored it would show "Pending" after the pass settled. The trailing debounce folds a pass's
 *   many commits into one repost.
 * - Never: the pending queue alone (`events`). Every chat turn journals messages; reposting on
 *   that would post the rail on every streamed message.
 */

import type { LocalFirstChange, LocalFirstStore } from "@builderforce/local-first";

/** The ids the last posted rail drew: its tickets' and its runs' local record ids. */
export interface RailScope {
  readonly ticketIds: ReadonlySet<string>;
  readonly runIds: ReadonlySet<string>;
}

const changedIds = (change: LocalFirstChange, type: "chat-ticket-link" | "ticket" | "execution"): ReadonlySet<string> =>
  change.records.get(type) ?? new Set<string>();

/** Whether `change` re-posts the rail at once. `scope` is the last posted rail's, or undefined before the first post. */
export function touchesRail(change: LocalFirstChange | undefined, scope?: RailScope): boolean {
  // `undefined` is "unknown, assume everything" (a reloaded store).
  if (!change) return true;
  if (changedIds(change, "chat-ticket-link").size > 0 || changedIds(change, "ticket").size > 0) return true;
  const runs = changedIds(change, "execution");
  if (runs.size === 0) return false;
  if (!scope) return true;
  for (const id of runs) if (scope.runIds.has(id) || scope.ticketIds.has(id)) return true;
  return false;
}

/** Whether `change` re-posts the rail after the sync pass settles (the trailing debounce). */
export function touchesRailSyncState(change: LocalFirstChange | undefined): boolean {
  return change?.syncState === true;
}

export interface RailWatchOptions {
  /** Quiet period before an immediate repost: a commit often writes several rows. */
  debounceMs?: number;
  /** Quiet period after the last sync-state change before its repost: one per sync pass. */
  syncDebounceMs?: number;
  /** The last posted rail's ids; undefined before the first post. */
  scope?: () => RailScope | undefined;
}

export const RAIL_SYNC_DEBOUNCE_MS = 1_000;

/** Call `repost` after any commit that touches the rail (debounced); returns the unsubscribe. */
export function watchRail(store: LocalFirstStore, repost: () => void, options: RailWatchOptions = {}): () => void {
  const delay = options.debounceMs ?? 100;
  const syncDelay = options.syncDebounceMs ?? RAIL_SYNC_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let syncTimer: ReturnType<typeof setTimeout> | undefined;
  const clearSync = () => {
    if (syncTimer !== undefined) clearTimeout(syncTimer);
    syncTimer = undefined;
  };
  const unsubscribe = store.subscribe((change) => {
    if (touchesRail(change, options.scope?.())) {
      // The read this schedules sees the sync state as it is now: a waiting sync repost is folded in.
      clearSync();
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        repost();
      }, delay);
      return;
    }
    if (!touchesRailSyncState(change)) return;
    clearSync();
    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      repost();
    }, syncDelay);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
    clearSync();
  };
}
