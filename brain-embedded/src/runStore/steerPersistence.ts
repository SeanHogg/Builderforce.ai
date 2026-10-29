/**
 * The person's steered message, saved and shown as the run reads it (PRD 35 E10).
 *
 * A message steered into a running chat arrives through the run's inbox, not through the
 * conversation's send — so nothing else would persist it or splice it into the live view. A
 * host that shows the person's words itself as it queues them (the editor's `say`) leaves
 * `persist` unset and this does nothing; a host that does not (the web composer, Rovr) sets
 * it, and the run saves the message when it drains it. The row is marked mid-turn so the
 * Evermind learn gate never trains on it and the reply it prompts stays the turn's answer.
 *
 * The row records the message's attachments in its metadata, as a normal turn's row does
 * (`attachmentTranscript.ts`), so a reload and a retry still have the pictures it carried.
 *
 * The save is AWAITED by the caller before the run's next row is written: the chat orders
 * rows by when they were saved, and a steer saved late would read as sent after the answer
 * it prompted.
 */

import { MID_TURN_META_KEY } from '@builderforce/agent-loop';
import type { RunSteerMessage } from '../runSteering';
import type { RunCell } from './runCell';
import { emit, nowIso, pushTrace, recordAppended } from './runCells';
import type { BrainRunPersistence } from './runTypes';

/** The metadata of a steered row: mid-turn, plus the attachments the message carried. */
export function steerMetadata(steer: Pick<RunSteerMessage, 'attachments'>): string {
  const attachments = steer.attachments ?? [];
  return JSON.stringify({ [MID_TURN_META_KEY]: true, ...(attachments.length > 0 ? { attachments } : {}) });
}

/**
 * Save one drained steer the run was asked to save, and splice it into the live view.
 * Resolves once it is saved (or the save failed, which is said on the trace); never rejects.
 */
export async function persistSteer(c: RunCell, chatId: number, persistence: Pick<BrainRunPersistence, 'sendMessages'>, steer: RunSteerMessage): Promise<void> {
  if (!steer.persist) return;
  try {
    const [msg] = await persistence.sendMessages(chatId, [{ role: 'user', content: steer.text, metadata: steerMetadata(steer) }]);
    if (!msg) return;
    recordAppended(c, msg);
    emit(c);
  } catch (e) {
    // The steer already reached the model; only its saved copy is lost - said on the trace
    // (a diagnostic step, like every trace result: English, read by triage, not a UI string).
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'steer.persist_failed',
      args: { error: e instanceof Error ? e.message : String(e) },
      result: 'The steered message reached the run but could not be saved to the chat.',
    });
  }
}
