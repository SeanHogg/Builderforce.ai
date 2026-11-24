/**
 * The native `@builderforce` participant's run: its VS Code chat-stream RENDERING around the ONE host start.
 *
 * The participant used to drive the shared loop itself (`runBrainLoop` with its own ports, its own run journal and no entry
 * point). It now starts exactly as the panel does - `host.start` (the editor's gated start: change-set identity, the run
 * journal's start, delta capture, `entryPoint: "vscode"`, the host's tools, gates, stream and persistence) - and keeps only
 * what is its own: turning the run store's observable state, and the host's tool and fallback announcements, into the
 * markdown the native chat view renders, and asking the person about a paused call through a modal (the view cannot render a
 * run cell's confirm).
 *
 * No `vscode` import: every visible string is injected, so the path is unit-testable (`participantRun.test.ts`).
 */

import { getRunSnapshot, getRunTrace, isRunning, subscribeRun } from "@seanhogg/builderforce-brain-embedded";
import type { BrainRunHost } from "./brainRunHostContract";
import { hostLog } from "./hostLog";
import type { WebviewRunStart } from "./brainRunHostProtocol";
import type { ChildApprover } from "./childApprovalRelay";
import { createStreamRelay, exhaustedToolBudget } from "./nativeRunStream";
import type { NativeRunEvents, NativeRunLabels } from "./nativeRunTypes";

/** The slice of the host the participant uses. */
export type ParticipantHost = Pick<BrainRunHost, "start" | "stop" | "isBusy" | "attach" | "registerApprover" | "clearError">;

export interface ParticipantRunOptions {
  host: ParticipantHost;
  /** The run as the host takes it - its `chatId` is the run's cell key (the local chat's view key). The participant's turn is text. */
  spec: WebviewRunStart & { userTurn?: string };
  /**
   * Saves the person's row for this turn (the participant is a SEND path, like the panel's composer; `host.start` never writes it)
   * and resolves its id, or `undefined` when the save failed (already logged; the turn still runs). The row is the person's WORDS
   * ONLY, by design: no `#file` turn context and no attachment metadata - those ride `spec.turnContext` to the model alone.
   */
  saveUserTurn(chatId: number, text: string): Promise<number | undefined>;
  /** Asked about every paused call of the chat's runs (the turn's own and its sub-agents'). */
  approve: ChildApprover;
  events: NativeRunEvents;
  labels: Pick<NativeRunLabels, "dispatchHint" | "alreadyRunning">;
  /** Hybrid's pick failed and the turn was answered with Auto (`reason` is why, already clamped). */
  onModelFallback(from: string, reason?: string): void;
  signal: AbortSignal;
}

/**
 * The shared save: one `{role: "user", content}` row through the chat's store (what the panel's composer saves), resolving its id.
 * A failed save is logged and resolves `undefined` - it never blocks the turn.
 */
export async function saveUserRow(
  persistence: { sendMessages(chatId: number, messages: Array<{ role: string; content: string }>): Promise<Array<{ id?: number }>> },
  chatId: number,
  text: string,
): Promise<number | undefined> {
  try {
    const [row] = await persistence.sendMessages(chatId, [{ role: "user", content: text }]);
    return row?.id;
  } catch (e) {
    hostLog(`[participant run] saving the user turn for chat ${chatId} failed: ${String(e)}`);
    return undefined;
  }
}

/**
 * Run one native chat turn through the host. Resolves `true` when the turn ran (or was stopped), `false` when the key was
 * already claimed or the request was cancelled first - nothing ran, so the caller records nothing for it.
 */
export async function runViaHost(opts: ParticipantRunOptions): Promise<boolean> {
  const { host, spec, events, labels, signal } = opts;
  const chatId = spec.chatId;
  // Claimed by another path (a second turn, the panel's run - the host also counts the window while a run is setting up).
  if (isRunning(chatId) || host.isBusy(chatId)) {
    if (labels.alreadyRunning) events.onError(labels.alreadyRunning, null);
    return false;
  }
  if (signal.aborted) return false;

  // The person's row first (as the panel's composer does), and the run reads its id. A Stop that lands DURING the save leaves the
  // row (as in the panel) but starts nothing: `host.start` is not yet running, so a late `host.stop` could not reach it.
  const savedId = spec.userTurn ? await opts.saveUserTurn(chatId, spec.userTurn) : undefined;
  if (signal.aborted) return true;
  const runSpec: WebviewRunStart = savedId != null ? { ...spec, userTurnMessageId: savedId } : spec;

  const unregisterApprover = host.registerApprover(chatId, opts.approve);
  const relayText = createStreamRelay(events);
  // The in-progress tool line: the run store's LIVE step (`snapshot.activity`, what the panel's activity indicator renders), shown
  // once per step - the host itself only announces a tool when it has finished (`run.tool`).
  let lastStep = "";
  const unsubscribe = subscribeRun(chatId, () => {
    const snapshot = getRunSnapshot(chatId);
    relayText(snapshot);
    const live = snapshot.activity;
    if (live?.phase !== "tool" || !live.label) return;
    const id = `${live.startedAt}:${live.label}:${live.detail ?? ""}`;
    if (id === lastStep) return;
    lastStep = id;
    events.onToolStart(live.detail ? `${live.label} ${live.detail}` : live.label);
  });
  // What the host announces about THIS chat's runs, rendered as the chat view's lines.
  const detach = host.attach({
    post(message) {
      if (!("chatId" in message) || message.chatId !== chatId) return;
      if (message.type === "run.tool") events.onToolResult(message.label ?? message.name, message.ok);
      else if (message.type === "run.modelFallback") opts.onModelFallback(message.from, message.reason);
      else if (message.type === "run.failed") events.onError(message.error, null);
    },
  });
  // A user Stop is the host's Stop: it cancels the in-flight completion and unwinds the run cleanly.
  const onAbort = () => host.stop(chatId);
  signal.addEventListener("abort", onAbort, { once: true });
  // Only THIS run's steps decide whether the budget was exhausted - a cell's trace spans every turn of the chat.
  const traceBefore = getRunTrace(chatId).length;
  try {
    await host.start(runSpec);
  } finally {
    // Deliver anything the last emit carried before we stop listening.
    relayText(getRunSnapshot(chatId));
    unsubscribe();
    detach();
    // This turn's approver goes with it: the owner's key answers it now, and a later panel run on this chat must reach its own confirm.
    unregisterApprover();
    signal.removeEventListener("abort", onAbort);
  }
  if (signal.aborted) return true;
  if (exhaustedToolBudget(getRunTrace(chatId).slice(traceBefore))) events.onText(`\n\n${labels.dispatchHint}\n`);
  // The run surfaces a failure on its cell rather than throwing: read it here and clear it, or the NEXT turn re-reports it.
  const settled = getRunSnapshot(chatId);
  if (settled.error) {
    events.onError(settled.error, settled.errorAction);
    host.clearError(chatId);
  }
  return true;
}
