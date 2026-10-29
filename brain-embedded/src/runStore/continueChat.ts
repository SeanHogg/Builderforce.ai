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
 * Every continuation runs UNDER A CLAIM on the chat (`runClaim.ts`), taken before its first
 * await. While it is held the chat is live: a person's message steers into the run being made,
 * nothing else can launch, and a Stop - even on an idle chat - keeps the saved rows and starts
 * nothing. The claim is checked at every await boundary and released on every exit.
 */

import { composeUserTurn, recordedModelText, type ComposedUserTurn } from '../attachmentTranscript';
import type { BrainPersistenceAdapter } from '../config';
import { withDirectedMetadata } from '../directedMessage';
import { drainRunSteering, queueRunSteering, type RunSteerMessage } from '../runSteering';
import { chatErrorAction } from '../chatError';
import type { ContentPart } from '../streamChatCompletion';
import type { BrainMessage, ChatInputAttachment } from '../types';
import type { RunCell } from './runCell';
import { emit, getCell, nowIso, onStoreReset, pushTrace, recordAppended } from './runCells';
import { claimRun, claimStopped, releaseClaim, type RunClaim } from './runClaim';
import { bounded, continuationLimits, within } from './deadline';
import { stopBeforeStart } from './runControl';
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
export function releaseContinuation(runKey: RunKey, binding: ContinueBinding): void {
  // Only the binding that asked: a newer conversation over the same chat keeps its own.
  if (bindings.get(runKey) !== binding) return;
  bindings.delete(runKey);
  depth.delete(runKey);
}

/** Forget every binding (`resetBrainRunStore`: tests, teardown). */
export function resetContinuations(): void {
  continuing.clear();
  bindings.clear();
  depth.clear();
}
onStoreReset(resetContinuations);

/** Was this run opted in? Reading consumes the mark: it is per run. */
export function takeContinueOnSettle(runKey: RunKey): boolean {
  return continuing.delete(runKey);
}

/** Start a run - injected, so this module stays below `startRun` in the import graph. */
type StartRun = (runKey: number, request: BrainRunRequest, claim?: RunClaim) => Promise<unknown>;

type Composed = ComposedUserTurn & { text: string; attachments: ChatInputAttachment[] };

/** The composition of a set of steers: ONE path, the same as a typed send (`composeUserTurn`). */
async function compose(steers: readonly RunSteerMessage[], ports: AttachmentPorts): Promise<Composed> {
  const text = steers.map((m) => m.text).join('\n\n');
  const attachments = steers.flatMap((m) => m.attachments ?? []);
  return { ...(await composeUserTurn(text, attachments, ports)), text, attachments };
}

/** Two model contents as one: text joined (`recordedModelText` - the one text extractor), pictures kept. */
function joinContent(a: string | ContentPart[], b: string | ContentPart[]): string | ContentPart[] {
  const text = `${recordedModelText(a)}\n\n${recordedModelText(b)}`;
  const pictures = [a, b].flatMap((c) => (typeof c === 'string' ? [] : c.filter((p) => p.type !== 'text')));
  return pictures.length > 0 ? [{ type: 'text', text }, ...pictures] : text;
}

/**
 * A continuation that ends WITHOUT a run (the row could not be saved, the host could not prepare one, the
 * start was rejected) says so where the person looks - the chat's error - with the failure's own message,
 * so words steered meanwhile do not sit unseen.
 */
function surface(c: RunCell, e: unknown): void {
  c.error = e instanceof Error ? e.message : String(e);
  c.errorAction = chatErrorAction(e);
  emit(c);
}

/**
 * Words whose row is saved but which cannot start a run now: they wait in the inbox as what the model
 * should read - the composed content (inlined text + links; pictures ride as attachments) - marked
 * `saved`, so nothing saves them again.
 */
function keepAsSaid(runKey: number, text: string, attachments: readonly ChatInputAttachment[]): void {
  const pictures = attachments.filter((a) => a.imageUrl);
  queueRunSteering(runKey, text, { fromPerson: true, saved: true, ...(pictures.length > 0 ? { attachments: pictures } : {}) });
}

function trace(c: RunCell, label: string, args: Record<string, unknown>, result: string): void {
  pushTrace(c, { ts: nowIso(), category: 'message', label, args, result });
}

/**
 * A Stop landed while the words were becoming the next turn. Whatever user row is saved is unanswered: a
 * reopened chat (the auto-reply on load, Retry) would run it after all. So it gets the same "stopped before
 * it started" answer a launch writes (`stopBeforeStart`) - bounded, like every await a claim holder makes.
 */
async function endStopped(c: RunCell, runKey: number, chatId: number, persistence: BrainRunRequest['persistence']): Promise<boolean> {
  await within(
    continuationLimits.prepareMs,
    async () => { await stopBeforeStart(runKey, chatId, persistence); },
    () => trace(c, 'steer.stop_unrecorded', {}, 'The stop could not be recorded in time; the saved message may run again when the chat is reopened.'),
  );
  return true;
}

/**
 * Make `steers` the chat's next turn, under `claim`. False when the chat cannot take it - it has no
 * request to run with (never ran in this session) or it has continued as often as it may without a
 * person's turn (`MAX_CONTINUATIONS`) - and the caller keeps the words. True when the words were
 * taken: made the next turn, or dropped because a Stop landed (the Stop ends the conversation's work;
 * rows already saved stay).
 */
export async function continueChat(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun, claim: RunClaim): Promise<boolean> {
  const request = c.lastRequest;
  const binding = bindings.get(runKey);
  if (!request || !binding || steers.length === 0) return false;
  const links = depth.get(runKey) ?? 0;
  if (links >= MAX_CONTINUATIONS) {
    trace(c, 'steer.continue_limit', { continuations: links }, 'The run was continued as often as it may be without a new message; the direction waits for your next turn.');
    return false;
  }
  const chatId = request.lineage?.rootChatId ?? runKey;
  const ports = binding.ports();
  // Words with a row already are not saved twice; the rest are saved FIRST, as the user's turn: the
  // order of the chat is the order it was said in, and a reload finds it. Each set is composed once.
  const fresh = steers.filter((m) => !m.saved);
  const said = steers.filter((m) => m.saved);
  const reading = continuationLimits.prepareMs;
  const freshTurn = fresh.length > 0 ? await bounded(reading, compose(fresh, ports)) : null;
  const saidTurn = said.length > 0 ? await bounded(reading, compose(said, ports)) : null;
  // No Stop check before the save: words already in hand are the person's message - a Stop keeps them as
  // a row (the record of what was said) and starts nothing, below.
  let row: BrainMessage | undefined;
  if (freshTurn) {
    // A plain user row (no mid-turn mark): the reply to it is an ordinary answer.
    const metadata = withDirectedMetadata(null, freshTurn.turn.meta);
    // Bounded like every await a claim holder makes. A save that is only SLOW may still land after the
    // timeout; the words then wait in the inbox to be saved again - at-least-once, never lost.
    [row] = await bounded(reading, Promise.resolve(request.persistence.sendMessages(chatId, [{ role: 'user', content: freshTurn.displayContent, ...(metadata ? { metadata } : {}) }])));
    if (row) {
      recordAppended(c, row);
      emit(c);
    }
    if (claimStopped(c, claim)) return endStopped(c, runKey, chatId, request.persistence);
  }
  const content = saidTurn && freshTurn ? joinContent(saidTurn.turn.content, freshTurn.turn.content) : (saidTurn ?? freshTurn)!.turn.content;
  // The host's run-time parts, fresh. A host that refuses leaves the (saved) words waiting in the inbox.
  let fresher: Partial<BrainRunRequest> | undefined;
  try {
    fresher = await bounded(continuationLimits.prepareMs, binding.prepareRun?.(runKey));
  } catch (e) {
    // A Stop that landed first ends it: its words are not requeued.
    if (claimStopped(c, claim)) return endStopped(c, runKey, chatId, request.persistence);
    surface(c, e);
    trace(c, 'steer.prepare_failed', { error: e instanceof Error ? e.message : String(e) },
      'The host could not prepare a run for direction the last run never read; it waits for the chat\'s next run.');
    keepAsSaid(runKey, recordedModelText(content), [...(freshTurn?.attachments ?? []), ...(saidTurn?.attachments ?? [])]);
    return true;
  }
  if (claimStopped(c, claim)) return endStopped(c, runKey, chatId, request.persistence);
  // The continuation keeps catching up with a person who keeps typing - to the bound above. Stop and
  // delete still end it: a stopped run continues nothing, and a deleted chat has no cell to start.
  depth.set(runKey, links + 1);
  continuing.add(runKey);
  // Started UNDER the claim, synchronously: the run consumes it, and nothing can have taken the chat.
  start(runKey, {
    ...request,
    ...fresher,
    userTurn: content,
    ...(row ? { userTurnMessageId: row.id } : {}),
  }, claim).catch((e: unknown) => {
    continuing.delete(runKey);
    surface(c, e);
    trace(c, 'steer.continue_failed', { error: e instanceof Error ? e.message : String(e) }, 'The continuation could not start.');
  });
  return true;
}

/**
 * Make `steers` the chat's next turn; when that cannot happen (the chat has no request to run
 * with, or saving the row failed - an expired token, a deleted chat) the words go back into the
 * inbox with their own flags, where the chat's next run reads them. Never dropped, never an
 * unhandled rejection; the failure is said on the trace. The claim is released on EVERY exit. THE
 * one place that decides this.
 */
async function continueOrKeep(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun, claim: RunClaim): Promise<boolean> {
  try {
    if (await continueChat(runKey, c, steers, start, claim)) return true;
  } catch (e) {
    surface(c, e);
    trace(c, 'steer.continue_failed', { error: e instanceof Error ? e.message : String(e) },
      'Direction the run never read could not be made the next turn; it waits for the chat\'s next run.');
  } finally {
    releaseClaim(c, claim);
  }
  for (const m of steers) {
    queueRunSteering(runKey, m.text, {
      ...(m.fromPerson ? { fromPerson: true } : {}),
      ...(m.persist ? { persist: true } : {}),
      ...(m.saved ? { saved: true } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });
  }
  return false;
}

/**
 * A settled run's leftover direction becomes the chat's next turn (or waits, kept, in its inbox).
 * `claim` was taken by the settling run at the moment it stopped running - the chat was never idle.
 */
export async function continueLeftovers(runKey: number, c: RunCell, start: StartRun, claim: RunClaim): Promise<void> {
  const left = drainRunSteering(runKey);
  if (left.length === 0) {
    releaseClaim(c, claim);
    return;
  }
  await continueOrKeep(runKey, c, left, start, claim);
}

/**
 * Hand a chat words it did not get - a turn whose send failed after the person switched away.
 * True when the chat has a request to run them with and is free to take them (they become its next
 * turn, or - if saving fails - wait in its inbox); false when it has none or a run or another
 * continuation holds it, and the caller keeps them (in the inbox that run reads).
 */
export function wakeChat(runKey: number, text: string, attachments: readonly ChatInputAttachment[] | undefined, start: StartRun): boolean {
  const c = getCell(runKey);
  if (!c.lastRequest || !bindings.has(runKey)) return false;
  const claim = claimRun(runKey);
  if (!claim) return false;
  depth.set(runKey, 0); // a person's turn: the chain starts over
  const steer: RunSteerMessage = { text, fromPerson: true, persist: true, ...(attachments?.length ? { attachments: [...attachments] } : {}) };
  void continueOrKeep(runKey, c, [steer], start, claim);
  return true;
}
