/**
 * The person's steered message, saved and shown as the run reads it (PRD 35 E10).
 *
 * A message steered into a running chat arrives through the run's inbox, not through the
 * conversation's send — so nothing else would persist it or splice it into the live view. A
 * host that shows the person's words itself as it queues them (the editor's `say`) leaves
 * `persist` unset and this does nothing; a host that does not (the web composer, Rovr) sets
 * it, and the run saves the message when it drains it. The row is marked mid-turn so the
 * Evermind learn gate never trains on it and the reply it prompts stays the turn's answer.
 */

import { MID_TURN_META_KEY } from '@builderforce/agent-loop';
import type { RunSteerMessage } from '../runSteering';
import type { RunCell } from './runCell';
import { emit, nowIso, pushTrace, recordAppended } from './runCells';
import type { BrainRunPersistence } from './runTypes';

/** Save one drained steer the run was asked to save, and splice it into the live view. */
export function persistSteer(c: RunCell, chatId: number, persistence: Pick<BrainRunPersistence, 'sendMessages'>, steer: RunSteerMessage): void {
  if (!steer.persist) return;
  void persistence
    .sendMessages(chatId, [{ role: 'user', content: steer.text, metadata: JSON.stringify({ [MID_TURN_META_KEY]: true }) }])
    .then(([msg]) => {
      if (!msg) return;
      recordAppended(c, msg);
      emit(c);
    })
    .catch((e: unknown) => {
      // The steer already reached the model; only its saved copy is lost — said on the trace.
      pushTrace(c, {
        ts: nowIso(),
        category: 'message',
        label: 'steer.persist_failed',
        result: `The message you sent mid-run reached the run but could not be saved to the chat (${e instanceof Error ? e.message : String(e)}).`,
      });
    });
}
