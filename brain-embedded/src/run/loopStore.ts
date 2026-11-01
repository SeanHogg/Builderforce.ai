/**
 * The agent's RUN STORE over a Brain run: the append-only log of the transcript (PRD 35 §4 WS4). Every row that joins the
 * agent's transcript - the model's answer, a tool result, a steer, a nudge - is appended to the cell's working transcript as
 * it happens, in the Brain's own row shape, because the Brain's guards, the read cache's anchors and the next run's seed
 * all read the cell. A tool result row also runs its call's post-step (`brainPlatformTools.ts`). Rows the compaction wrote
 * are not announced. A Brain run is one continuous loop in one process, so there is nothing to load or save.
 */

import { replayTextOf } from '@builderforce/agent-loop';
import type { RunStore } from '@builderforce/agent-run';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { markPersonTurn } from '../runStore/chatAsks';
import type { RunCell } from '../runStore/runCell';
import { toStreamMessage } from './modelTransport';

export interface LoopStoreOptions {
  toolRowAppended: (row: ChatCompletionMessage) => void;
  commitMemory?: (consolidated: unknown) => Promise<void> | void;
  /** Is this user row the person's own steered words (`loopSteering.ts`)? Only theirs is one of the chat's asks (`chatAsks.ts`). */
  personSteer?: (text: string) => boolean;
}

export function loopRunStore(c: RunCell, opts: LoopStoreOptions): RunStore {
  return {
    load: () => undefined,
    save: () => undefined,
    appended(row) {
      if (row.role === 'system') return;
      const wire = toStreamMessage(row);
      // A past turn is shown to the model again as its reply (else its reasoning as plain text), never the tags - the Brain's loop keeps
      // `replayTextOf` in its transcript, so a row the agent wrote with the tags (a settled answer) reads the same.
      if (wire.role === 'assistant' && typeof wire.content === 'string') wire.content = replayTextOf(wire.content);
      if (row.role === 'user' && opts.personSteer?.(row.content)) markPersonTurn(wire);
      c.transcript.push(wire);
      if (row.role === 'tool') opts.toolRowAppended(wire);
    },
    ...(opts.commitMemory ? { commitMemory: opts.commitMemory } : {}),
  };
}
