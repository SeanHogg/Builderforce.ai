/**
 * The Brain's RUN STORE (PRD 35 §3.2 `RunStore`) — where a run's state lives.
 *
 * On the Brain the state lives in the CELL (`runStore/runCell.ts`): the chat's working
 * transcript is the cross-turn grounding, held in memory for the session, and the cell's
 * `running` claim is the single-flight guard. A Brain run is one continuous loop in one
 * process — it never resumes from a saved tick — so `load()` has nothing to resume from;
 * `save()` appends what the run added to the cell's transcript, so the chat's next run seeds
 * from it. Rows the cell already holds are never replaced: their identity carries the
 * person-turn marks (`chatAsks.ts`) and the fold anchors (`runFoldMarker.ts`).
 *
 * `commitMemory` is the run-end write-back (codemap facts, the session note): the host's
 * own commit, passed in — the store does not know how a host remembers.
 */

import type { RunState, RunStore } from '@builderforce/agent-run';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { RunCell } from '../runStore/runCell';
import { toStreamMessage } from './modelTransport';

/** The agent's transcript in the cell's shape. The system prompt is the run's, not the chat's. */
export function transcriptOf(state: RunState): ChatCompletionMessage[] {
  const rows: ChatCompletionMessage[] = [];
  for (const raw of state.messages) {
    const row = raw as { role?: string };
    if (row.role === 'system' || typeof row.role !== 'string') continue;
    rows.push(toStreamMessage(raw as Parameters<typeof toStreamMessage>[0]));
  }
  return rows;
}

/**
 * The store over one run cell. `seeded` is how many of the cell's rows open the run's transcript
 * (after its system prompt); only the rows after them are new. A run that starts from the task
 * alone has none, and everything it adds is appended.
 */
export function cellRunStore(c: RunCell, opts: { seeded?: number; commitMemory?: (consolidated: unknown) => Promise<void> | void } = {}): RunStore {
  let written = opts.seeded ?? 0;
  return {
    load: () => undefined,
    save(state: RunState): void {
      const rows = transcriptOf(state);
      if (rows.length > written) c.transcript.push(...rows.slice(written));
      written = Math.max(written, rows.length);
    },
    ...(opts.commitMemory ? { commitMemory: opts.commitMemory } : {}),
  };
}
