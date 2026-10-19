/**
 * Dead-letter export and repair. Export never removes an entry. Repair moves one
 * entry back onto the durable queue only when the caller names that entry's id.
 */

import type { OutboxEntry } from "./types.js";

/** Copies of the dead letters in `entries`, in queue order. Does not mutate or remove them. */
export function exportDeadLetters<T, K>(entries: readonly OutboxEntry<T, K>[]): OutboxEntry<T, K>[] {
  return entries
    .filter((entry) => entry.deadLetter)
    .map((entry) => ({ ...entry, deadLetter: { ...entry.deadLetter! } }))
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Move one dead letter back onto the durable queue. Returns that entry only when
 * `id` is a non-empty id of a dead letter in `entries`. Any other id — missing,
 * blank, or not a dead letter — leaves the list unchanged.
 */
export function repairDeadLetter<T, K>(
  entries: readonly OutboxEntry<T, K>[],
  id: string,
): OutboxEntry<T, K> | null {
  if (typeof id !== "string" || id.trim() === "") return null;
  const entry = entries.find((candidate) => candidate.id === id && candidate.deadLetter);
  if (!entry) return null;
  delete entry.deadLetter;
  delete entry.batch;
  entry.retention = "durable";
  return entry;
}
