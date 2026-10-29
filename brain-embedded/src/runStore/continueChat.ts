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
 * composer's Stop drains the inbox), and a Stop that lands while the words are being made the
 * next turn - even on an idle chat (`RunCell.stopEpoch`) - keeps the saved row and starts nothing.
 */

import { composeUserTurn, type ComposedUserTurn } from '../attachmentTranscript';
import type { BrainPersistenceAdapter } from '../config';
import { withDirectedMetadata } from '../directedMessage';
import { drainRunSteering, queueRunSteering, type RunSteerMessage } from '../runSteering';
import type { BrainMessage, ChatInputAttachment } from '../types';
import type { RunCell } from './runCell';
import { emit, getCell, nowIso, pushTrace, recordAppended } from './runCells';
import type { BrainRunRequest, RunKey } from './runTypes';

/** What a user turn's files need to be linked and made model-readable - the conversation's adapter. */
export type AttachmentPorts = Pick<BrainPersistenceAdapter, 'uploadUrl' | 'inlineAttachments'>;

/**
 * What a chat needs to continue itself. Read at the time, never captured: the ports are the
 * conversation's newest, and `prepareRun` (the host's run-time parts - the working tab, the
 * tool catalog, the system prompt, the model and mode) is asked AGAIN for each continuation, so
 * a continuation never runs with the parts of a run that ended minutes ago.
 */
export interface ContinueBinding {
  ports: () => AttachmentPorts;
  prepareRun?: (chatId: number) => Promise<Partial<BrainRunRequest>>;
}

/**
 * Chains of continuations stop here. A continuation run whose own inbox is non-empty at its end
 * continues again, so a chat keeps catching up with a person who keeps typing - but a
 * run that never stops receiving direction cannot keep a chat going forever on its own: past
 * this many continuations the words wait in the inbox for the person's next turn (a trace line
 * says so). Reset by every run a person's turn launches (`continueOnSettle`, `wakeChat`).
 */
export const MAX_CONTINUATIONS = 5;

/** Runs that carry their leftover direction into the chat's next turn when they settle. */
const continuing = new Set<RunKey>();
/** What each chat continues with. Released when the conversation that bound it unmounts. */
const bindings = new Map<RunKey, ContinueBinding>();
/** Continuations in a row, per chat. */
const depth = new Map<RunKey, number>();

/** Opt a run in (the web/Rovr conversation does, at launch; the editor's host has its own wake). */
export function continueOnSettle(runKey: RunKey, binding: ContinueBinding): void {
  bindings.set(runKey, binding);
  depth.set(runKey, 0);
  continuing.add(runKey);
}

/** The conversation that bound this chat is gone: nothing can compose its words any more. */
export function releaseContinuation(runKey: RunKey): void {
  bindings.delete(runKey);
  depth.delete(runKey);
}

/** Forget every binding (`resetBrainRunStore`: tests, teardown). */
export function resetContinuations(): void {
  continuing.clear();
  bindings.clear();
  depth.clear();
}

/** Was this run opted in? Reading consumes the mark: it is per run. */
export function takeContinueOnSettle(runKey: RunKey): boolean {
  return continuing.delete(runKey);
}

/** Start a run - injected, so this module stays below `startRun` in the import graph. */
type StartRun = (runKey: number, request: BrainRunRequest) => Promise<void>;

/** Words the chat already holds a row for: said while a run was starting, queued without `persist`. */
const alreadySaved = (m: RunSteerMessage): boolean => !!m.fromPerson && !m.persist;

/** The composition of a set of steers: ONE path, the same as a typed send (`composeUserTurn`). */
function compose(steers: readonly RunSteerMessage[], ports: AttachmentPorts): Promise<ComposedUserTurn & { text: string; attachments: ChatInputAttachment[] }> {
  const text = steers.map((m) => m.text).join('\n\n');
  const attachments = steers.flatMap((m) => m.attachments ?? []);
  return composeUserTurn(text, attachments, ports).then((composed) => ({ ...composed, text, attachments }));
}

/**
 * Words whose row is saved but which cannot start a run now: they wait in the inbox as what the
 * model should read - the composed content (inlined text + links; pictures ride as attachments) -
 * and are NOT saved again. `interrupt` is for a run that is going: it reads them at its next call.
 */
function keepAsSaid(runKey: number, composed: ComposedUserTurn & { attachments: ChatInputAttachment[] }, interrupt: boolean): void {
  const { content } = composed.turn;
  const text = typeof content === 'string' ? content : content.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n\n');
  const pictures = composed.attachments.filter((a) => a.imageUrl);
  queueRunSteering(runKey, text, { fromPerson: true, ...(interrupt ? { interrupt: true } : {}), ...(pictures.length > 0 ? { attachments: pictures } : {}) });
}

/**
 * Make `steers` the chat's next turn. False when the chat cannot take it - it has no request to
 * run with (never ran in this session), a run holds it, or it has continued as often as it may
 * without a person's turn (`MAX_CONTINUATIONS`) - and the caller keeps the words. `epoch` is
 * the chat's Stop count when the words were taken: a Stop since keeps the row, starts nothing.
 */
export async function continueChat(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun, epoch: number): Promise<boolean> {
  const request = c.lastRequest;
  const binding = bindings.get(runKey);
  if (!request || !binding || c.running || steers.length === 0) return false;
  const links = depth.get(runKey) ?? 0;
  if (links >= MAX_CONTINUATIONS) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'steer.continue_limit',
      args: { continuations: links },
      result: 'The run was continued as often as it may be without a new message; the direction waits for your next turn.',
    });
    return false;
  }
  const chatId = request.lineage?.rootChatId ?? runKey;
  const ports = binding.ports();
  const all = await compose(steers, ports);
  // Saved FIRST, as the user's turn: the order of the chat is the order it was said in, and a
  // reload finds it. Only words with no row yet: a duplicate user row is a message said twice.
  // A plain user row (no mid-turn mark): the reply to it is an ordinary answer.
  const fresh = steers.filter((m) => !alreadySaved(m));
  let row: BrainMessage | undefined;
  if (fresh.length > 0) {
    const said = fresh.length === steers.length ? all : await compose(fresh, ports);
    const metadata = withDirectedMetadata(null, said.turn.meta);
    [row] = await request.persistence.sendMessages(chatId, [{ role: 'user', content: said.displayContent, ...(metadata ? { metadata } : {}) }]);
    if (row) {
      recordAppended(c, row);
      emit(c);
    }
  }
  // A Stop landed while this was being saved - on an idle chat too: the row stays, nothing starts.
  if (c.stopEpoch !== epoch) return true;
  // A run started while the row was being saved: it never reads the row, so the words go into
  // ITS inbox (saved already - not persisted again) and the run reads them at its next call.
  if (c.running) {
    keepAsSaid(runKey, all, true);
    return true;
  }
  // The host's run-time parts, fresh. A host that refuses leaves the words (saved) waiting.
  let fresher: Partial<BrainRunRequest> | undefined;
  try {
    fresher = await binding.prepareRun?.(runKey);
  } catch (e) {
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'steer.prepare_failed',
      args: { error: e instanceof Error ? e.message : String(e) },
      result: 'The host could not prepare a run for direction the last run never read; it waits for the chat\'s next run.',
    });
    keepAsSaid(runKey, all, false);
    return true;
  }
  // The continuation keeps catching up with a person who keeps typing - to the bound above. Stop and
  // delete still end it: a stopped run continues nothing, and a deleted chat has no cell to start.
  depth.set(runKey, links + 1);
  continuing.add(runKey);
  start(runKey, {
    ...request,
    ...fresher,
    userTurn: all.turn.content,
    ...(row ? { userTurnMessageId: row.id } : {}),
  }).catch((e: unknown) => {
    continuing.delete(runKey);
    pushTrace(c, {
      ts: nowIso(),
      category: 'message',
      label: 'steer.continue_failed',
      args: { error: e instanceof Error ? e.message : String(e) },
      result: 'The continuation could not start.',
    });
  });
  return true;
}

/**
 * Make `steers` the chat's next turn; when that cannot happen (the chat has no request to run
 * with, or saving the row failed - an expired token, a deleted chat) the words go back into the
 * inbox with their own flags, where the chat's next run reads them. Never dropped, never an
 * unhandled rejection; the failure is said on the trace. THE one place that decides this.
 */
async function continueOrKeep(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun, epoch: number): Promise<boolean> {
  try {
    if (await continueChat(runKey, c, steers, start, epoch)) return true;
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
  const epoch = c.stopEpoch;
  const left = drainRunSteering(runKey);
  if (left.length > 0) await continueOrKeep(runKey, c, left, start, epoch);
}

/**
 * Hand a chat words it did not get - a turn whose send failed after the person switched away.
 * True when the chat has a request to run them with (they become its next turn, or - if saving
 * fails - wait in its inbox); false when it has none, and the caller keeps them.
 */
export function wakeChat(runKey: number, text: string, attachments: readonly ChatInputAttachment[] | undefined, start: StartRun): boolean {
  const c = getCell(runKey);
  if (c.running || !c.lastRequest || !bindings.has(runKey)) return false;
  depth.set(runKey, 0); // a person's turn: the chain starts over
  const steer: RunSteerMessage = { text, fromPerson: true, persist: true, ...(attachments?.length ? { attachments: [...attachments] } : {}) };
  void continueOrKeep(runKey, c, [steer], start, c.stopEpoch);
  return true;
}
