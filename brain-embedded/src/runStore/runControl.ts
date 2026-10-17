/**
 * The run store's OBSERVE-AND-CONTROL surface — everything a mounted view, a run driver
 * or a tool that waits calls on a chat's run cell: subscribe and read the snapshot,
 * Stop, clear the error, answer a confirmation, mirror a run executing elsewhere.
 * Starting a run is `startRun.ts`; the loop itself is `runLoop.ts`.
 */

import type { BrainMessage } from '../types';
import type { BrainTraceEvent } from '../brainTriage';
import { getRunDriver } from '../runDriver';
import { forgetResolvedModels } from '../lastResolvedModel';
import { toolActivity } from '../runActivity';
import { EMPTY_SNAPSHOT } from './runCell';
import { cells, emit, getCell, pushTrace, recordAppended, storeListeners } from './runCells';
import { stoppedTurnOf } from './turnPersistence';
import type { BrainRunSnapshot, GlobalRunState } from './runTypes';

/**
 * Drop all run state. For tests/teardown only — there's no per-chat eviction in
 * normal operation (transcripts are session-lived grounding, as before).
 */
export function resetBrainRunStore(): void {
  cells.clear();
  forgetResolvedModels();
}

/** Number of run cells currently retained in memory (diagnostics/tests). */
export function getRunStoreSize(): number {
  return cells.size;
}

/**
 * Subscribe to ANY run-state change across all chats (a run starting, finishing,
 * or pausing on a confirm — in any chat, mounted or not). Returns an unsubscribe
 * fn. Pair with {@link getGlobalRunState} to render a cross-chat live indicator.
 */
export function subscribeRunStore(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

/**
 * Which chats are live right now, split into actively-executing (`running`) and
 * paused-on-a-confirm (`awaiting`). Disjoint: a chat paused on a confirm is in
 * `awaiting` only. Recomputed from the current cells on each call — cheap (a scan
 * of the bounded cell map); callers debounce via a stable key of the two lists.
 */
export function getGlobalRunState(): GlobalRunState {
  const running: number[] = [];
  const awaiting: number[] = [];
  for (const [id, cell] of cells) {
    if (cell.pendingConfirm) awaiting.push(id);
    else if (cell.running) running.push(id);
  }
  return { running, awaiting };
}

/** Subscribe to a chat's run state. Returns an unsubscribe fn. */
export function subscribeRun(chatId: number, listener: () => void): () => void {
  const c = getCell(chatId);
  c.listeners.add(listener);
  return () => {
    c.listeners.delete(listener);
  };
}

/**
 * The cancel signal of a chat's IN-FLIGHT run, or undefined when nothing is running.
 *
 * Exists for the same reason {@link requestRunConfirm} is callable from outside the
 * cell: work the run starts that is not the loop itself — a delegated sub-agent running
 * its own nested loop inside one tool call — must stop when the user presses Stop, and
 * the controller is created by {@link startRun}, after the host has already assembled the
 * catalog that carries that tool. So the tool reads it at CALL time, by chat.
 */
export function runAbortSignal(chatId: number): AbortSignal | undefined {
  return cells.get(chatId)?.abort?.signal;
}

/**
 * Splice a message persisted OUTSIDE the loop into a chat's live view — a delegated
 * child's report, posted while its parent run is still going. Persisting alone put it in
 * the chat store, but the panel showed it only after a reload: mounted views merge the
 * run's `appended` buffer, and nothing had told the buffer.
 */
export function appendRunMessage(chatId: number, msg: BrainMessage): void {
  const c = cells.get(chatId);
  if (!c) return;
  recordAppended(c, msg);
  emit(c);
}

/** Current snapshot (referentially stable until something changes). */
export function getRunSnapshot(chatId: number | null): BrainRunSnapshot {
  if (chatId == null) return EMPTY_SNAPSHOT;
  return (cells.get(chatId)?.snapshot) ?? EMPTY_SNAPSHOT;
}

export function isRunning(chatId: number | null): boolean {
  return chatId != null && (cells.get(chatId)?.running ?? false);
}

/** The accumulated execution trace for a chat (for the capture/triage report). */
export function getRunTrace(chatId: number | null): BrainTraceEvent[] {
  if (chatId == null) return [];
  return cells.get(chatId)?.trace ?? [];
}

/**
 * Stop a chat's in-flight run. Aborts the streaming LLM request (which rejects
 * the in-flight `stream()` — the loop treats an aborted signal as a clean exit,
 * surfacing no error) and resolves any paused human-in-the-loop confirmation as
 * declined so a loop waiting on the gate can also unwind. Records a `stopped`
 * trace step for triage. No-op if nothing is running for this chat.
 *
 * What the model was streaming, and which model it was, are captured FIRST — a Stop
 * is pressed exactly when a model has gone wrong, and clearing the bubble used to
 * destroy the only evidence of what it did. The unwinding run persists both
 * ({@link keepStoppedTurn}); see `stoppedTurn.ts`.
 *
 * `running` flips to false when `runLoop` unwinds and `startRun`'s `finally`
 * fires; we emit here too so the Stop is reflected immediately.
 */
export function stopRun(chatId: number): void {
  const driver = getRunDriver();
  if (driver) return driver.stop(chatId);
  const c = cells.get(chatId);
  if (!c || !c.running) return;
  const stopped = stoppedTurnOf(c);
  c.stoppedTurn = stopped;
  c.abort?.abort();
  if (c.confirmResolver) {
    const resolve = c.confirmResolver;
    c.confirmResolver = null;
    c.pendingConfirm = null;
    resolve(false);
  }
  c.streamingText = '';
  // Nothing is in flight any more. Cleared here as well as in startRun's finally
  // so the indicator disappears the instant Stop is pressed, rather than when the
  // aborted loop finally unwinds.
  c.activity = null;
  // pushTrace emits, so subscribers see both the trace step and the cleared
  // streaming buffer in one go.
  pushTrace(c, stopped.event);
}

/**
 * Clear a chat's surfaced run error so the UI's error banner can be dismissed.
 * The error lives on the run cell (set when the LLM stream / tool loop threw),
 * so the hook's local `setError('')` can't reach it — this is the store-side
 * companion `clearError()` calls. No-op when there's no cell or no error.
 */
export function clearRunError(chatId: number | null): void {
  if (chatId == null) return;
  const driver = getRunDriver();
  if (driver) return driver.clearError(chatId);
  const c = cells.get(chatId);
  if (!c || !c.error) return;
  c.error = '';
  c.errorAction = null;
  emit(c);
}

/**
 * Ask the human about one tool call and wait for the answer — the ONE way a pending
 * confirmation is raised on a chat's run cell.
 *
 * It exists as a function rather than as four lines inside the tool loop because the
 * loop is no longer the only thing that needs to ask. A sub-agent delegated by a run
 * executes in its own nested loop, and a child that could not reach this channel was a
 * child that could only ever read — which is why local delegation was investigation-only
 * until this became callable from outside.
 *
 * The resolver lives on the CELL, so whichever Brain instance is mounted answers it —
 * including one that navigated in after the question was asked. Answered by
 * {@link resolveRunConfirm}; a Stop unwinds it as a decline so nothing waits forever.
 *
 * Returns false immediately when the run for this chat is driven by ANOTHER process
 * (a run driver is installed): the confirming UI belongs to whoever owns the loop, and
 * a caller here has no channel to it. Declining is the safe answer — the action simply
 * does not happen.
 */
export function requestRunConfirm(
  chatId: number,
  req: { name: string; args: unknown },
  opts?: { step?: number },
): Promise<boolean> {
  if (getRunDriver()) return Promise.resolve(false);
  const c = getCell(chatId);
  return new Promise<boolean>((resolve) => {
    c.pendingConfirm = { name: req.name, args: req.args };
    c.confirmResolver = resolve;
    // Waiting on a HUMAN, not on us. The indicator must stop animating as though work
    // is happening — nothing advances until the user answers.
    c.activity = {
      ...toolActivity(req.name, req.args, opts?.step ?? c.activity?.step ?? 0, Date.now()),
      phase: 'awaiting',
    };
    emit(c);
  });
}

/** Resolve a pending human-in-the-loop confirmation. No-op if none is pending. */
export function resolveRunConfirm(chatId: number, ok: boolean): void {
  const driver = getRunDriver();
  if (driver) return driver.confirm(chatId, ok);
  const c = cells.get(chatId);
  if (!c || !c.confirmResolver) return;
  const resolve = c.confirmResolver;
  c.confirmResolver = null;
  c.pendingConfirm = null;
  emit(c);
  resolve(ok);
}

/**
 * Mirror a run that is executing in ANOTHER process into this store's cell, so every
 * local reader — the conversation hook, the timeline, `getGlobalRunState` — sees it
 * exactly as it would see an in-process run. The only writer of a cell that no local
 * loop owns; a locally running cell is never overwritten (the local loop is the
 * truth for it). `trace` is taken as sent: the remote side decides how much of its
 * bounded trace to ship (see the VS Code host's delta relay).
 */
export function applyRemoteRun(chatId: number, snapshot: BrainRunSnapshot): void {
  const c = getCell(chatId);
  if (c.abort) return; // an in-process loop owns this cell
  c.running = snapshot.running;
  c.streamingText = snapshot.streamingText;
  c.error = snapshot.error;
  c.errorAction = snapshot.errorAction;
  c.pendingConfirm = snapshot.pendingConfirm;
  c.messagesEpoch = snapshot.messagesEpoch;
  c.appended = snapshot.appended;
  c.trace = snapshot.trace;
  // A mirrored run's trace is replaced wholesale, so no local run index survives it.
  c.runTraceFrom = 0;
  c.activity = snapshot.activity;
  c.byoUnresolved = snapshot.byoUnresolved;
  c.providerCap = snapshot.providerCap;
  emit(c);
}
