/**
 * What a chat does with direction nobody read - the web/Rovr twin of the editor host's
 * `runSteer.settled` + `wake` (`clients/vscode/src/runSteer.ts`).
 *
 * A message steered into a run is read at the run's next turn. One that arrives after the
 * run's final drain is never read, and an in-memory inbox is the wrong place for a person's
 * words to wait: it is lost on a reload, and it would surface after the NEXT thing they type.
 * So when a run that opted in settles (`continueOnSettle`), whatever is left in its inbox
 * becomes THAT chat's next turn - saved as a user row, then run with the request the chat
 * last ran with - whichever chat is on screen. The same door takes a turn handed to a chat
 * that is no longer showing (`wakeChat`).
 *
 * A Stop ends the conversation's work, waiting words included: the caller drops them (the
 * composer's Stop drains the inbox), and a stopped run continues nothing.
 */

import { drainRunSteering, queueRunSteering, steerModelContent, type RunSteerMessage } from '../runSteering';
import type { ChatInputAttachment } from '../types';
import type { RunCell } from './runCell';
import { emit, getCell, nowIso, pushTrace, recordAppended } from './runCells';
import type { BrainRunRequest, RunKey } from './runTypes';

/** Runs that carry their leftover direction into the chat's next turn when they settle. */
const continuing = new Set<RunKey>();

/** Opt a run in (the web/Rovr conversation does, at launch; the editor's host has its own wake). */
export function continueOnSettle(runKey: RunKey): void {
  continuing.add(runKey);
}

/** Was this run opted in? Reading consumes the mark: it is per run. */
export function takeContinueOnSettle(runKey: RunKey): boolean {
  return continuing.delete(runKey);
}

/** Start a run - injected, so this module stays below `startRun` in the import graph. */
type StartRun = (runKey: number, request: BrainRunRequest) => Promise<void>;

/**
 * Make `steers` the chat's next turn. False when the chat cannot take it - it has no request to
 * run with (never ran in this session) or a run holds it - and the caller keeps the words.
 */
export async function continueChat(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun): Promise<boolean> {
  const request = c.lastRequest;
  if (!request || c.running || steers.length === 0) return false;
  const text = steers.map((m) => m.text).join('\n\n');
  const attachments: ChatInputAttachment[] = steers.flatMap((m) => m.attachments ?? []);
  const chatId = request.lineage?.rootChatId ?? runKey;
  // Saved FIRST, as the user's turn: the order of the chat is the order it was said in, and
  // a reload finds it. A plain user row (no mid-turn mark): the reply to it is an ordinary answer.
  const [row] = await request.persistence.sendMessages(chatId, [{
    role: 'user',
    content: text,
    ...(attachments.length > 0 ? { metadata: JSON.stringify({ attachments }) } : {}),
  }]);
  // The chat may have started a run while the row was being saved; the row stays, the words
  // are not run twice.
  if (row) {
    recordAppended(c, row);
    emit(c);
  }
  if (c.running) return true;
  void start(runKey, {
    ...request,
    userTurn: steerModelContent({ text, ...(attachments.length > 0 ? { attachments } : {}) }),
    ...(row ? { userTurnMessageId: row.id } : {}),
    seed: undefined,
    seedIds: undefined,
    priorResearch: undefined,
  });
  return true;
}

/**
 * Hand a chat words it did not get - a turn whose send failed after the person switched away.
 * True when the chat took them as its next turn (or a run of its own will read them); the
 * caller keeps them otherwise.
 */
export function wakeChat(runKey: number, text: string, attachments: readonly ChatInputAttachment[] | undefined, start: StartRun): boolean {
  const c = getCell(runKey);
  const steer: RunSteerMessage = { text, fromPerson: true, ...(attachments?.length ? { attachments: [...attachments] } : {}) };
  if (c.running) return false;
  void continueChat(runKey, c, [steer], start);
  return !!c.lastRequest;
}

/**
 * A settled run's leftover direction becomes the chat's next turn. When that cannot happen (the
 * chat has no request to run with, or saving the row failed) the words go back into the inbox,
 * where the chat's next run reads them - never dropped, and the failure is said on the trace.
 */
export async function continueLeftovers(runKey: number, c: RunCell, start: StartRun): Promise<void> {
  const left = drainRunSteering(runKey);
  if (left.length === 0) return;
  try {
    if (await continueChat(runKey, c, left, start)) return;
  } catch (e) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'steer.continue_failed',
      args: { error: e instanceof Error ? e.message : String(e) },
      result: 'Direction the run never read could not be made the next turn; it waits for the chat\'s next run.',
    });
  }
  for (const m of left) {
    queueRunSteering(runKey, m.text, { fromPerson: true, persist: true, ...(m.attachments?.length ? { attachments: m.attachments } : {}) });
  }
}
