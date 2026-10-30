/**
 * What a chat does with direction nobody read - the web/Rovr twin of the editor host's
 * `runSteer.settled` + `wake` (`clients/vscode/src/runSteer.ts`).
 *
 * A message steered into a run is read at the run's next turn. One that arrives after the
 * run's final drain is never read, and an in-memory inbox is the wrong place for a person's
 * words to wait. So when a run that opted in settles (`continueOnSettle`), whatever is left in
 * its inbox becomes THAT chat's next turn - saved as user rows, then run with the request the
 * chat last ran with - whichever chat is on screen. The same door takes a turn handed to a chat
 * that is no longer showing (`wakeChat`).
 *
 * "Kept" is true: words the run will save are written to the device's journal the moment they
 * are queued (`pendingWords.ts`, by `queueRunSteering`) and cleared when saved, so a reload
 * before the (bounded) network save lands finds them and saves them under the SAME key. Every
 * steer is its own row under its own key (the server and the device store upsert on it), so a
 * save that times out and lands late, then is saved again from the requeued words, is one row.
 *
 * THE RUN STORE OWNS THIS. It runs whether or not any view is mounted, so nothing else drains
 * the inbox for it: the turn hook (`useChatTurns`) flushes only the turns the UI itself holds.
 *
 * Every continuation runs UNDER A CLAIM on the chat (`runClaim.ts`), taken before its first
 * await. While it is held the chat is live: a person's message steers into the run being made,
 * nothing else can launch, and a Stop - even on an idle chat - starts nothing. The claim is
 * checked at every await boundary and released on every exit.
 */

import { composeUserTurn, recordedModelText, type ComposedUserTurn } from '../attachmentTranscript';
import type { BrainPersistenceAdapter } from '../config';
import { withDirectedMetadata } from '../directedMessage';
import { forgetPendingWords, rememberPendingWords } from '../pendingWords';
import { drainRunSteering, newSteerKey, queueRunSteering, type RunSteerMessage } from '../runSteering';
import { chatErrorAction } from '../chatError';
import type { ContentPart } from '../streamChatCompletion';
import type { BrainMessage, ChatInputAttachment } from '../types';
import type { RunCell } from './runCell';
import { emit, getCell, nowIso, onStoreReset, pushTrace, recordAppended } from './runCells';
import { claimRun, claimStopped, releaseClaim, type RunClaim } from './runClaim';
import { bounded, budget, continuationLimits, settledWithin, within } from './deadline';
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

/** The chat a run's rows live in: its owner's for a sub-agent, its own otherwise. THE one place that says so here. */
const chatIdOf = (request: BrainRunRequest, runKey: number): number => request.lineage?.rootChatId ?? runKey;

/** The composition of one steer: ONE path, the same as a typed send (`composeUserTurn`). */
async function compose(m: RunSteerMessage, ports: AttachmentPorts): Promise<Composed> {
  const attachments = m.attachments ?? [];
  return { ...(await composeUserTurn(m.text, attachments, ports)), text: m.text, attachments };
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

/** Put steers back in the inbox, in their original order, each with its own flags and its own row key. */
function requeue(runKey: number, steers: readonly RunSteerMessage[]): void {
  for (const m of steers) {
    queueRunSteering(runKey, m.text, {
      ...(m.fromPerson ? { fromPerson: true } : {}),
      ...(m.persist ? { persist: true } : {}),
      ...(m.saved ? { saved: true } : {}),
      ...(m.eventKey ? { eventKey: m.eventKey } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    });
  }
}

function trace(c: RunCell, label: string, args: Record<string, unknown>, result: string): void {
  pushTrace(c, { ts: nowIso(), category: 'message', label, args, result });
}

/**
 * A Stop landed while the words were becoming the next turn. A saved user row is unanswered, and a reopened chat
 * (the auto-reply on load, Retry) would run it after all - so it gets the same "stopped before it started" answer a
 * launch writes (`stopBeforeStart`). But ONLY after the in-flight save has settled: the answer must come AFTER the
 * row, and a save that never lands must leave no orphan answer.
 *  - no save in flight (the rows were saved before): write now, within the remaining `ms`;
 *  - the save succeeded within `ms`: write now;
 *  - the save failed: write nothing (there is no row to answer);
 *  - the save is still in flight past `ms`: the claim is released by the caller, and the answer is chained onto the
 *    save in the background, outside it - never touching a newer turn's view.
 */
async function endStopped(
  c: RunCell,
  runKey: number,
  chatId: number,
  persistence: BrainRunRequest['persistence'],
  claim: RunClaim,
  ms: number,
  saving: Promise<unknown> | null,
): Promise<boolean> {
  const state = saving ? await settledWithin(ms, saving) : 'ok';
  if (state === 'failed') return true;
  if (state === 'pending') {
    void saving!.then(
      () => stopBeforeStart(runKey, chatId, persistence, () => false),
      () => undefined, // it failed after all: no row, so no answer
    );
    return true;
  }
  await within(
    ms,
    // The cell is only touched while this continuation still holds the chat (a late write never lands in a newer turn's view).
    async () => { await stopBeforeStart(runKey, chatId, persistence, () => c.claim === claim); },
    () => trace(c, 'steer.stop_unrecorded', {}, 'The stop could not be recorded in time; the saved message may run again when the chat is reopened.'),
  );
  return true;
}

/**
 * Make `steers` the chat's next turn, under `claim`. False when the chat cannot take it - it has no
 * request to run with (never ran in this session) or it has continued as often as it may without a
 * person's turn (`MAX_CONTINUATIONS`) - and the caller keeps the words. True when the words were
 * taken: made the next turn, or dropped because a Stop landed (the Stop ends the conversation's work).
 * `left` is the ONE allowance the whole continuation shares (reading, saving, preparing).
 */
export async function continueChat(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun, claim: RunClaim, left: () => number): Promise<boolean> {
  const request = c.lastRequest;
  const binding = bindings.get(runKey);
  if (!request || !binding || steers.length === 0) return false;
  const links = depth.get(runKey) ?? 0;
  if (links >= MAX_CONTINUATIONS) {
    trace(c, 'steer.continue_limit', { continuations: links }, 'The run was continued as often as it may be without a new message; the direction waits for your next turn.');
    return false;
  }
  const chatId = chatIdOf(request, runKey);
  const ports = binding.ports();
  // Each steer is composed ONCE, in the order it was said: its own row (when it has none yet) and its share of the
  // model's turn. Fresh words never go ahead of earlier ones.
  const turns: Array<{ steer: RunSteerMessage; composed: Composed }> = [];
  for (const steer of steers) turns.push({ steer, composed: await bounded(left(), compose(steer, ports)) });
  const fresh = turns.filter((t) => !t.steer.saved);
  let rows: BrainMessage[] = [];
  if (fresh.length > 0) {
    // One row PER steer, each under its own key: a save that times out and lands late, then is saved again from the
    // requeued words, is the same rows - never a second set. A plain user row (no mid-turn mark): the reply is an ordinary answer.
    const saving = Promise.resolve(request.persistence.sendMessages(chatId, fresh.map(({ steer, composed }) => {
      const metadata = withDirectedMetadata(null, composed.turn.meta);
      return { role: 'user', content: composed.displayContent, ...(metadata ? { metadata } : {}), ...(steer.eventKey ? { eventKey: steer.eventKey } : {}) };
    })));
    try {
      rows = await bounded(left(), saving);
    } catch (e) {
      if (claimStopped(c, claim)) return endStopped(c, runKey, chatId, request.persistence, claim, left(), saving);
      throw e;
    }
    for (const row of rows) recordAppended(c, row);
    emit(c);
    forgetPendingWords(runKey, fresh.map((t) => t.steer.eventKey));
    if (claimStopped(c, claim)) return endStopped(c, runKey, chatId, request.persistence, claim, left(), null);
  }
  const content = turns.map((t) => t.composed.turn.content).reduce((all, next) => joinContent(all, next));
  // The host's run-time parts, fresh. A host that refuses leaves the (saved) words waiting in the inbox.
  let fresher: Partial<BrainRunRequest> | undefined;
  try {
    fresher = await bounded(left(), binding.prepareRun?.(runKey));
  } catch (e) {
    // A Stop that landed first ends it: its words are not requeued.
    if (claimStopped(c, claim)) return endStopped(c, runKey, chatId, request.persistence, claim, left(), null);
    surface(c, e);
    trace(c, 'steer.prepare_failed', { error: e instanceof Error ? e.message : String(e) },
      'The host could not prepare a run for direction the last run never read; it waits for the chat\'s next run.');
    keepAsSaid(runKey, recordedModelText(content), turns.flatMap((t) => t.composed.attachments));
    return true;
  }
  if (claimStopped(c, claim)) return endStopped(c, runKey, chatId, request.persistence, claim, left(), null);
  // The continuation keeps catching up with a person who keeps typing - to the bound above. Stop and
  // delete still end it: a stopped run continues nothing, and a deleted chat has no cell to start.
  depth.set(runKey, links + 1);
  continuing.add(runKey);
  const row = rows[rows.length - 1];
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
 * inbox, in their original order, each with its own flags and key, where the chat's next run reads
 * them. Never dropped, never an unhandled rejection; the failure is said on the trace. The claim is
 * released on EVERY exit. THE one place that decides this.
 */
async function continueOrKeep(runKey: number, c: RunCell, steers: readonly RunSteerMessage[], start: StartRun, claim: RunClaim): Promise<boolean> {
  // A steer with no key yet (an owner's, a child's) gets one BEFORE its first save attempt, and keeps it through every requeue.
  const keyed = steers.map((m) => (m.saved || m.eventKey ? m : { ...m, eventKey: newSteerKey() }));
  const left = budget(continuationLimits.prepareMs);
  try {
    if (await continueChat(runKey, c, keyed, start, claim, left)) return true;
  } catch (e) {
    // A Stop ends it: its words are NEVER requeued. A row may exist (a save that timed out can still land), so the
    // stopped answer is written - within what is LEFT of the allowance - and a reopened chat does not run it after all.
    if (claimStopped(c, claim)) {
      const request = c.lastRequest;
      if (request) await endStopped(c, runKey, chatIdOf(request, runKey), request.persistence, claim, left(), null);
      releaseClaim(c, claim);
      return true;
    }
    surface(c, e);
    trace(c, 'steer.continue_failed', { error: e instanceof Error ? e.message : String(e) },
      'Direction the run never read could not be made the next turn; it waits for the chat\'s next run.');
  } finally {
    releaseClaim(c, claim);
  }
  requeue(runKey, keyed);
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
  // Keyed once and journaled on the device like any other words the run will save, then handed to the continuation.
  const eventKey = newSteerKey();
  rememberPendingWords(runKey, eventKey, text.trim());
  const steer: RunSteerMessage = { text, fromPerson: true, persist: true, eventKey, ...(attachments?.length ? { attachments: [...attachments] } : {}) };
  void continueOrKeep(runKey, c, [steer], start, claim);
  return true;
}
