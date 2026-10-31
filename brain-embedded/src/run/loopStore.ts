/**
 * The agent's RUN STORE over a Brain run: the append-only log of the transcript (PRD 35 §4 WS4). Every row that joins the
 * agent's transcript - the model's answer, a tool result, a steer, a nudge - is appended to the cell's working transcript as
 * it happens, in the Brain's own row shape, because the Brain's guards, the read cache's anchors and the next run's seed
 * all read the cell. A tool result row also runs its call's post-step (`brainPlatformTools.ts`). Rows the compaction wrote
 * are not announced. A Brain run is one continuous loop in one process, so there is nothing to load or save.
 */

import type { RunStore } from '@builderforce/agent-run';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import type { RunCell } from '../runStore/runCell';
import { toStreamMessage } from './modelTransport';

export function loopRunStore(c: RunCell, opts: { toolRowAppended: (row: ChatCompletionMessage) => void; commitMemory?: (consolidated: unknown) => Promise<void> | void }): RunStore {
  return {
    load: () => undefined,
    save: () => undefined,
    appended(row) {
      if (row.role === 'system') return;
      const wire = toStreamMessage(row);
      c.transcript.push(wire);
      if (row.role === 'tool') opts.toolRowAppended(wire);
    },
    ...(opts.commitMemory ? { commitMemory: opts.commitMemory } : {}),
  };
}
