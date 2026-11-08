/**
 * When a store commit is worth re-posting the rail for (G21): it touched the chat, one of its
 * links, one of its tickets or a run, or changed the sync state (a receipt, a mapping, a queued
 * or acknowledged event) that every row's status is derived from.
 *
 * A streamed message or a usage row touches none of these, so a long chat turn does not repost
 * the rail on every token. Which ticket or link belongs to THIS chat is not known without a read,
 * so a change to any link, ticket or run counts: a spurious repost costs one local read, a missed
 * one leaves the rail stale.
 */

import type { LocalFirstChange, LocalFirstStore } from "@builderforce/local-first";

const RAIL_ENTITY_TYPES = ["chat-ticket-link", "ticket", "execution"] as const;

export function touchesRail(change: LocalFirstChange | undefined, chatClientId: string | undefined): boolean {
  // `undefined` is "unknown, assume everything" (a reloaded store).
  if (!change) return true;
  if (change.events || change.syncState) return true;
  if (chatClientId !== undefined && change.records.get("chat")?.has(chatClientId)) return true;
  return RAIL_ENTITY_TYPES.some((type) => (change.records.get(type)?.size ?? 0) > 0);
}

export interface RailWatchOptions {
  /** Quiet period before the repost: a commit often writes several rows. */
  debounceMs?: number;
}

/**
 * Call `repost` after any commit that touches the rail (debounced). `chatClientId` is read live
 * (a chat bound later gains its id); returns the unsubscribe.
 */
export function watchRail(
  store: LocalFirstStore,
  chatClientId: () => string | undefined,
  repost: () => void,
  options: RailWatchOptions = {},
): () => void {
  const delay = options.debounceMs ?? 100;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = store.subscribe((change) => {
    if (!touchesRail(change, chatClientId())) return;
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
