/**
 * Per-visit timeline marks, capped.
 *
 * The recorder already classified rage / dead / quick-back / error; ingest
 * copies those marks and assigns `ord` after whatever is already stored.
 * Once {@link REPLAY_LIMITS.maxMarksPerVisit} is reached, plain clicks drop
 * first so pages, custom events, frustration and errors still fit.
 */

import {
  REPLAY_LIMITS,
  type ReplayChunk,
  type ReplayMark,
} from '@builderforce/interaction-contract';

/** A copied mark with the visit-local order ingest will persist. */
export type AssignedReplayMark = ReplayMark & { ord: number };

const DROPPABLE_KIND = 'click';

/**
 * Marks from this chunk that still fit under the per-visit cap, with `ord`
 * continuing from `existingCount`. An already-full visit inserts nothing.
 */
export function marksToInsert(existingCount: number, chunk: ReplayChunk): AssignedReplayMark[] {
  const cap = REPLAY_LIMITS.maxMarksPerVisit;
  const room = cap - Math.max(0, existingCount);
  if (room <= 0) return [];

  const incoming = chunk.marks ?? [];
  if (incoming.length === 0) return [];

  let kept: ReplayMark[] = incoming.slice();
  let drop = kept.length - room;
  if (drop > 0) {
    for (let i = kept.length - 1; i >= 0 && drop > 0; i--) {
      if (kept[i]?.kind === DROPPABLE_KIND) {
        kept.splice(i, 1);
        drop -= 1;
      }
    }
  }
  if (kept.length > room) kept = kept.slice(0, room);

  return kept.map((mark, i) => ({ ...mark, ord: existingCount + i }));
}
