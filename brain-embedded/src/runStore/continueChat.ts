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
 * THE RUN STORE OWNS THIS. It runs whether or not any view is mounted, so nothing else drains
 * the inbox for it: the turn hook (`useChatTurns`) flushes only the turns the UI itself holds.
 *
 * A Stop ends the conversation's work, waiting words included: the caller drops them (the
 * composer's Stop drains the inbox), and a stopped run continues nothing.
 */

import { composeUserTurn } from '../attachmentTranscript';
import type { BrainPersistenceAdapter } from '../config';
import { withDirectedMetadata } from '../directedMessage';
import { drainRunSteering, queueRunSteering, type RunSteerMessage } from '../runSteering';
import type { ChatInputAttachment } from '../types';
import type { RunCell } from './runCell';
import { emit, getCell, nowIso, pushTrace, recordAppended } from './runCells';
import type { BrainRunRequest, RunKey } from './runTypes';

/** What a user turn's files need to be linked and made model-readable - the conversation's adapter. */
export type AttachmentPorts = Pick<BrainPersistenceAdapter, 'uploadUrl' | 'inlineAttachments'>;

/**
 * Chains of continuations stop here. A continuation run whose own inbox is non-empty at its end
 * continues again, so a chat keeps catching up with a person who keeps typing mid-run - but a
 * run that never stops receiving direction cannot keep a chat going forever on its own: past
 * this many continuations the words wait in the inbox for the person's next turn. Reset by every
 * run a person's turn launches (`continueOnSettle`, `wakeChat`).
 */
export const MAX_CONTINUATIONS = 5;

/** Runs that carry their leftover direction into the chat's next turn when they settle. */
const continuing = new Set<RunKey>();
/** The adapter each chat's files are composed with. Kept per chat for the session (bounded by chats). */
const adapters = new Map<RunKey, AttachmentPorts>();
/** Continuations in a row, per chat. */
const depth = new Map<RunKey, number>();

/** Opt a run in (the web/Rovr conversation does, at launch; the editor's host has its own wake). */
export function continueOnSettle(runKey: RunKey, ports: AttachmentPorts): void {
  adapters.set(runKey, ports);
  depth.set(runKey, 0);
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
 * run with (never ran in this session), a run holds it, or it has continued as often as it may
 * without a person's turn (`MAX_CONTINUATIONS`) - and the caller keeps the words.
 */
export async function continueChat(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun): Promise<boolean> {
  const request = c.lastRequest;
  const ports = adapters.get(runKey);
  const links = depth.get(runKey) ?? 0;
  if (!request || !ports || c.running || steers.length === 0 || links >= MAX_CONTINUATIONS) return false;
  const text = steers.map((m) => m.text).join('\n\n');
  const attachments: ChatInputAttachment[] = steers.flatMap((m) => m.attachments ?? []);
  const chatId = request.lineage?.rootChatId ?? runKey;
  // The same composition as a typed send: the row's text with a link per file, the model's content
  // with pictures as vision parts and readable files inlined, and the record that goes with them.
  const { displayContent, turn } = await composeUserTurn(text, attachments, ports);
  const metadata = withDirectedMetadata(null, turn.meta);
  // Saved FIRST, as the user's turn: the order of the chat is the order it was said in, and
  // a reload finds it. A plain user row (no mid-turn mark): the reply to it is an ordinary answer.
  const [row] = await request.persistence.sendMessages(chatId, [{ role: 'user', content: displayContent, ...(metadata ? { metadata } : {}) }]);
  if (row) {
    recordAppended(c, row);
    emit(c);
  }
  // A run started while the row was being saved: it never reads the row, so the words go into
  // ITS inbox (saved already - not persisted again) and the run reads them at its next turn.
  if (c.running) {
    queueRunSteering(runKey, text, { fromPerson: true, ...(attachments.length > 0 ? { attachments } : {}) });
    return true;
  }
  // The continuation keeps catching up with a person who keeps typing - to the bound above. Stop and
  // delete still end it: a stopped run continues nothing, and a deleted chat has no cell to start.
  depth.set(runKey, links + 1);
  continuing.add(runKey);
  void start(runKey, {
    ...request,
    userTurn: turn.content,
    ...(row ? { userTurnMessageId: row.id } : {}),
  });
  return true;
}

/**
 * Make `steers` the chat's next turn; when that cannot happen (the chat has no request to run
 * with, or saving the row failed - an expired token, a deleted chat) the words go back into the
 * inbox with their own flags, where the chat's next run reads them. Never dropped, never an
 * unhandled rejection; the failure is said on the trace. THE one place that decides this.
 */
async function continueOrKeep(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun): Promise<boolean> {
  try {
    if (await continueChat(runKey, c, steers, start)) return true;
  } catch (e) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'steer.continue_failed',
      args: { error: e instanceof Error ? e.message : String(e) },
      result: 'Direction the run never read could not be made the next turn; it waits for the chat\'s next run.',
    });
  }
  for (const m of steers) {
    queueRunSteering(runKey, m.text, {
      ...(m.fromPerson ? { fromPerson: true } : {}),
      ...(m.persist ? { persist: true } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });
  }
  return false;
}

/** A settled run's leftover direction becomes the chat's next turn (or waits, kept, in its inbox). */
export async function continueLeftovers(runKey: number, c: RunCell, start: StartRun): Promise<void> {
  const left = drainRunSteering(runKey);
  if (left.length > 0) await continueOrKeep(runKey, c, left, start);
}

/**
 * Hand a chat words it did not get - a turn whose send failed after the person switched away.
 * True when the chat has a request to run them with (they become its next turn, or - if saving
 * fails - wait in its inbox); false when it has none, and the caller keeps them.
 */
export function wakeChat(runKey: number, text: string, attachments: readonly ChatInputAttachment[] | undefined, start: StartRun): boolean {
  const c = getCell(runKey);
  if (c.running || !c.lastRequest || !adapters.has(runKey)) return false;
  depth.set(runKey, 0); // a person's turn: the chain starts over
  const steer: RunSteerMessage = { text, fromPerson: true, persist: true, ...(attachments?.length ? { attachments: [...attachments] } : {}) };
  void continueOrKeep(runKey, c, [steer], start);
  return true;
}
