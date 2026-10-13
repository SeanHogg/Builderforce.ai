/**
 * The recording's timeline marks (`marks.json` beside its R2 chunks), capped.
 *
 * The recorder already classified rage / dead / quick back / error; ingest copies
 * those marks and appends them to the recording's `marks.json`. Once
 * {@link REPLAY_LIMITS.maxMarksPerVisit} is reached nothing more is added, and when a
 * chunk would overflow the cap, PLAIN clicks drop first so pages, custom events,
 * frustration and errors — the marks a person scrubs to — still fit.
 */

import { REPLAY_LIMITS, type ReplayMark } from '@builderforce/interaction-contract';

const DROPPABLE_KIND = 'click';

/** The marks from this chunk that still fit after `existingCount` stored marks. */
export function marksToAppend(existingCount: number, marks: readonly ReplayMark[]): ReplayMark[] {
  const room = REPLAY_LIMITS.maxMarksPerVisit - Math.max(0, existingCount);
  if (room <= 0 || marks.length === 0) return [];

  const kept = marks.slice();
  let drop = kept.length - room;
  // Drop the LATEST plain clicks first: the earliest ones are the context for what
  // followed, and the order of what remains is preserved.
  for (let i = kept.length - 1; i >= 0 && drop > 0; i--) {
    if (kept[i]?.kind === DROPPABLE_KIND) {
      kept.splice(i, 1);
      drop -= 1;
    }
  }
  return kept.length > room ? kept.slice(0, room) : kept;
}

/** The stored timeline after appending a chunk's marks, ordered by `atMs`. */
export function appendMarks(existing: readonly ReplayMark[], marks: readonly ReplayMark[]): ReplayMark[] {
  const added = marksToAppend(existing.length, marks);
  if (added.length === 0) return existing.slice();
  return [...existing, ...added].sort((a, b) => a.atMs - b.atMs);
}
