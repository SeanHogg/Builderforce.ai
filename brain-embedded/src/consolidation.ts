/**
 * Chat consolidation markers.
 *
 * A long conversation can be compressed into a single summary that becomes the
 * new base context — everything before the marker stays visible in the
 * transcript, but is dropped from what gets sent to the model on the next turn.
 * The marker is a normal assistant message (so the user SEES the summary the AI
 * produced) tagged with `{ consolidation: true }` in its metadata. Keeping the
 * flag in metadata (not the text) means the summary reads naturally while the
 * seed-builder can still find it reliably.
 *
 * This is the single source of truth for the marker convention, shared by the
 * conversation loop (which trims the model seed to the last marker) and any host
 * that creates a marker (the IDE's "Consolidate" / "Fork" actions).
 */

import type { BrainMessage } from './types';

/** The metadata key that flags an assistant message as a consolidation marker. */
export const CONSOLIDATION_META = { consolidation: true } as const;

/** Serialized metadata for a consolidation marker message (ready to persist). */
export function consolidationMetadata(): string {
  return JSON.stringify(CONSOLIDATION_META);
}

/** True when a persisted message is a consolidation marker (by its metadata flag). */
export function isConsolidationMarker(msg: { metadata?: string | null }): boolean {
  if (!msg.metadata) return false;
  try {
    return (JSON.parse(msg.metadata) as { consolidation?: unknown })?.consolidation === true;
  } catch {
    return false;
  }
}

/**
 * The index of the LAST consolidation marker in a message list, or -1 if none.
 * The seed-builder slices FROM this index (inclusive) so the summary itself is
 * the base context the next turn sees.
 */
export function lastConsolidationIndex(messages: Array<{ metadata?: string | null }>): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isConsolidationMarker(messages[i])) return i;
  }
  return -1;
}

/**
 * Trim a message list to the compressed context: everything from the last
 * consolidation marker onward. Returns the list unchanged when there is no
 * marker. Used to build the model seed so a consolidated chat sends the summary
 * instead of the full (large) history — the whole point of consolidating.
 */
export function scopeToConsolidation<T extends { metadata?: string | null }>(messages: T[]): T[] {
  const idx = lastConsolidationIndex(messages);
  return idx >= 0 ? messages.slice(idx) : messages;
}

/** The visible header prefixed onto a consolidation summary so the user recognizes it. */
export const CONSOLIDATION_MARKER_PREFIX = '📌 **Consolidated summary** — context continues from here.\n\n';

/** Wrap a raw summary as the marker's visible content (prefix + summary). */
export function consolidationMarkerContent(summary: string): string {
  return `${CONSOLIDATION_MARKER_PREFIX}${summary.trim()}`;
}

export type { BrainMessage };
