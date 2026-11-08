/**
 * When a store commit is worth re-posting the rail for (G21): it wrote a chat-ticket link, a
 * ticket or a run. Nothing else.
 *
 * Every chat turn journals messages (the queue changes) and every sync pass writes receipts and
 * mappings (the sync state changes): reposting on those would post the rail on every streamed
 * message. A row's sync badge is re-read with the next rail read or refresh instead. Which link,
 * ticket or run belongs to THIS chat is not known without a read, so any of them counts: a spurious
 * repost costs one local read, a missed one leaves the rail stale.
 */

import type { LocalFirstChange, LocalFirstStore } from "@builderforce/local-first";

const RAIL_ENTITY_TYPES = ["chat-ticket-link", "ticket", "execution"] as const;

export function touchesRail(change: LocalFirstChange | undefined): boolean {
  // `undefined` is "unknown, assume everything" (a reloaded store).
  if (!change) return true;
  return RAIL_ENTITY_TYPES.some((type) => (change.records.get(type)?.size ?? 0) > 0);
}

export interface RailWatchOptions {
  /** Quiet period before the repost: a commit often writes several rows. */
  debounceMs?: number;
}

/** Call `repost` after any commit that touches the rail (debounced); returns the unsubscribe. */
export function watchRail(store: LocalFirstStore, repost: () => void, options: RailWatchOptions = {}): () => void {
  const delay = options.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe((change) => {
    if (!touchesRail(change)) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      repost();
    }, delay);
  });
  return () => {
    unsubscribe();
    if (timer !== undefined) clearTimeout(timer);
  };
}
