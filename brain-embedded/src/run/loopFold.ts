/**
 * The agent's compaction, made the Brain's (PRD 35 §4 WS4 "compaction and the durable fold marker"). The agent folds the older
 * middle of ITS transcript into a note and says so with `context.compacted`; the Brain's cell has to learn the same fact, or
 * the read cache would stub a result the model can no longer see (`stillInWorkingContext` reads the cell's memo), and the next
 * run would summarise the same history again. This is the reaction: the visible step, the cell's memo, and the durable marker
 * (`persistFoldMarker`, the SAME writer the Brain's loop calls).
 */

import type { RunEvent } from '@builderforce/agent-run';
import type { RunLoopContext } from '../runStore/runLoopContext';
import { persistFoldMarker } from '../runStore/runFoldMarker';
import { emit, nowIso, pushTrace } from '../runStore/runCells';

type Compacted = Extract<RunEvent, { kind: 'context.compacted' }>;

export function loopFoldReaction(run: RunLoopContext): (event: Compacted) => void {
  const { c, chatId } = run;
  return (event) => {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'context.compacted',
      args: { droppedMessages: event.dropped },
      result: `Compressed ${event.dropped} earlier step(s) into a memory to stay within the context window.`,
    });
    emit(c);
    if (!event.note || !event.covered) return;
    // `covered` counts from the first row of the AGENT's transcript, whose first row is the previous fold's note: the cell's rows
    // are the ones that note stands for plus the ones since. Never under-count (a stub for a vanished result costs the run); an
    // extra row only earns a replay.
    const priorEnd = c.compactMemo?.coveredEnd ?? 0;
    const coveredEnd = priorEnd + event.covered - (c.compactMemo ? 1 : 0);
    c.compactMemo = { note: event.note, coveredEnd };
    // Durable: the next run seeds from this note instead of summarising the history again.
    void persistFoldMarker(c, chatId, run.req.persistence, { droppedMessages: event.dropped, note: event.note, coveredEnd });
  };
}
