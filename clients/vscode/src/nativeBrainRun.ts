/**
 * The native `@builderforce` chat participant's engine — the SHARED brain-embedded
 * run loop, driven headlessly.
 *
 * There used to be two agentic loops in this extension: the webview Brain on
 * `brain-embedded`'s `runBrainLoop`, and a second, native one that re-implemented tool
 * execution, approvals, governance gates, the code-change→ticket backstops and Evermind
 * recall for the chat participant. The second one could not be given the memory-first
 * "skip the LLM" short-circuit without writing that a second time too, which is exactly
 * the duplication the consolidation removes: this module OWNS NO LOOP. It assembles the
 * capabilities the host can provide — the workspace tool defs, a persistence port, the
 * approval UX, the compiled policy gates, the Evermind memory hooks, the streaming
 * transport — hands them to `runBrainLoop`, and translates what the shared loop emits
 * into the markdown/progress calls a `ChatResponseStream` understands.
 *
 * It is deliberately free of any RUNTIME `vscode` import (types only), for two reasons:
 * every visible string is injected by the caller so it can go through `vscode.l10n.t()`,
 * and the whole path is then unit-testable against the real loop with a scripted
 * gateway — see `nativeBrainRun.test.ts`.
 */


import {
  clearRunError,
  streamChatCompletion,
  getRunSnapshot,
  getRunTrace,
  isRunning,
  resolveRunConfirm,
  runBrainLoop,
  stopRun,
  subscribeRun,
  withUsageSurface,
  USAGE_SURFACE_HEADER,
  type UsageSurface,
  type BrainStreamFn,
  type BrainTransport,
} from "@seanhogg/builderforce-brain-embedded";
import { withRunPreamble } from "./runPreamble";
import { runRequestFields } from "./stageModels";
import { createStreamRelay, exhaustedToolBudget, transientRunPersistence } from "./nativeRunStream";
import { approvalRequestFor, createNativeRunTool, nativeNeedsConfirm, nativeToolSpecs } from "./nativeRunTool";
import type { NativeBrainRunOptions } from "./nativeRunTypes";

// The run's contract, its tool bridge and its stream relay live in their own modules
// (`nativeRunTypes.ts`, `nativeRunTool.ts`, `nativeRunStream.ts`); every name is re-exported
// here so importers of this module are unchanged.
export type { NativeApprovalRequest, NativeBrainRunOptions, NativeRunEvents, NativeRunLabels } from "./nativeRunTypes";
export {
  approvalRequestFor,
  argsRecord,
  createNativeRunTool,
  nativeNeedsConfirm,
  nativeToolSpecs,
  parseToolOutput,
  toolDefActions,
  toolLabel,
} from "./nativeRunTool";
export { createStreamRelay, exhaustedToolBudget, transientRunPersistence };

/**
 * The header that tells the gateway WHICH surface spent the tokens, so BYO / free
 * metering attributes an editor turn to the editor. It used to be set by the deleted
 * SDK adapter through an environment variable; it now rides the transport, which is
 * the only place both chat surfaces can share it.
 */
export const SURFACE_HEADER = USAGE_SURFACE_HEADER;
export const SURFACE_VALUE = "vsix" satisfies UsageSurface;

/**
 * The streaming completion fn for the native surface.
 *
 * Error mapping is deliberately the package default: it preserves the gateway's
 * STRUCTURED entitlement fields (402 needs-a-card, 401 expired session), which is what
 * lets the participant offer "Upgrade" / "Add a card" instead of restating a refusal.
 * `fetchImpl` exists so a test can read the outgoing headers; production passes nothing.
 */
export function createNativeStream(
  baseUrl: string,
  apiKey: string,
  fetchImpl: (input: string, init: RequestInit) => Promise<Response> = (input, init) => fetch(input, init),
): BrainStreamFn {
  const transport: BrainTransport = {
    baseUrl,
    getToken: () => apiKey,
    fetch: withUsageSurface(fetchImpl, SURFACE_VALUE),
  };
  return (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
}

/**
 * Run one native chat turn on the shared loop.
 *
 * Resolves when the loop has settled — including its post-run backstops, which run
 * inside `runBrainLoop`'s own teardown — so the caller can persist the turn knowing
 * every visible line has already been streamed.
 */
export async function runNativeBrain(opts: NativeBrainRunOptions): Promise<void> {
  const {
    chatId,
    tools,
    root,
    policyGates,
    directives,
    permissionMode,
    events,
    labels,
    signal,
  } = opts;

  // The chat's run is already in flight on another path (a second turn, the panel's run): this
  // call claimed nothing, so it neither starts a run nor settles one that is not its own - the
  // jobs it would kill belong to the run that holds the key.
  if (isRunning(chatId)) {
    if (labels.alreadyRunning) events.onError(labels.alreadyRunning, null);
    return;
  }

  const native = createNativeRunTool({
    defs: tools,
    root,
    ...(policyGates ? { gates: policyGates } : {}),
    ...(directives ? { hooks: directives.hooks } : {}),
    events,
    labels,
    // The run's default checkout and its key: git and shell default to the checkout, and the
    // background jobs the run starts are owned by its key — so they die with it.
    ...(opts.defaultRepo ? { defaultRepo: opts.defaultRepo } : {}),
    runKey: chatId,
  });
  const repoReady = opts.repoReady;
  const runTool: typeof native = repoReady
    ? async (name, args, signal) => {
        await repoReady;
        return native(name, args, signal);
      }
    : native;
  // Governance rides in TWO places, both of them here: the gates are rendered as binding
  // system-prompt lines so the model is bound by the same policy on every surface, and
  // they are HARD-enforced at the tool seam above. Rendering it here (rather than in the
  // caller) keeps the two halves of one capability from drifting apart. The workspace's
  // rules follow, in the one preamble both surfaces share.
  const systemPrompt = withRunPreamble(opts.systemPrompt, { gates: policyGates, rules: directives?.rules });
  const relayText = createStreamRelay(events);
  const persistence = opts.persistence ?? transientRunPersistence();

  // A user Stop cancels the in-flight completion and unwinds the loop cleanly — the
  // same Stop the webview's button fires.
  const onAbort = () => stopRun(chatId);
  if (signal.aborted) return;
  signal.addEventListener("abort", onAbort, { once: true });

  // Human-in-the-loop: the loop pauses by publishing a `pendingConfirm` and waiting;
  // whoever is watching answers with `resolveRunConfirm`. Here that watcher is the
  // participant's modal. One at a time — the loop only ever has one pending.
  let confirming = false;
  const unsubscribe = subscribeRun(chatId, () => {
    const snapshot = getRunSnapshot(chatId);
    relayText(snapshot);
    const pending = snapshot.pendingConfirm;
    if (!pending || confirming) return;
    confirming = true;
    void Promise.resolve(opts.approve(approvalRequestFor(tools, policyGates, pending.name, pending.args)))
      .catch(() => false)
      .then((ok) => {
        resolveRunConfirm(chatId, ok === true);
        confirming = false;
      });
  });

  // Only THIS run's steps decide whether the budget was exhausted — a cell's trace
  // spans every turn of the chat.
  const traceBefore = getRunTrace(chatId).length;

  try {
    await runBrainLoop(chatId, {
      resolvedSystemPrompt: systemPrompt,
      tools: nativeToolSpecs(tools),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.modelStrict != null ? { modelStrict: opts.modelStrict } : {}),
      ...(opts.routingMode ? { routingMode: opts.routingMode } : {}),
      ...(opts.chatMode ? { chatMode: opts.chatMode } : {}),
      ...(opts.serverChatId !== undefined ? { serverChatId: opts.serverChatId } : {}),
      ...(opts.clientChatId ? { clientChatId: opts.clientChatId } : {}),
      ...(opts.projectId != null ? { projectId: opts.projectId } : {}),
      ...(opts.evermind ? { evermind: opts.evermind } : {}),
      ...opts.runContext,
      ...(opts.prefetch ? { prefetch: opts.prefetch } : {}),
      ...(opts.knowledge ? { knowledge: opts.knowledge } : {}),
      ...runRequestFields(opts.runSettings, { child: false }),
      ...(opts.recordRunOutcome ? { recordRunOutcome: opts.recordRunOutcome } : {}),
      ...(opts.recordAvoidedCall ? { recordAvoidedCall: opts.recordAvoidedCall } : {}),
      runTool,
      needsConfirm: nativeNeedsConfirm(tools, permissionMode, policyGates),
      stream: opts.stream,
      persistence,
      seed: opts.seed,
      userTurn: opts.userTurn,
      ...(directives ? { onStop: directives.hooks.onStop } : {}),
    });
  } finally {
    // Deliver anything the last emit carried before we stop listening.
    relayText(getRunSnapshot(chatId));
    unsubscribe();
    signal.removeEventListener("abort", onAbort);
    // The workspace's runEnd hooks — after the turn, never holding it.
    void directives?.hooks.onRunEnd();
    // What the run held outside the loop (its background jobs) dies with it.
    opts.settleRun?.(chatId);
  }

  if (signal.aborted) return;

  if (exhaustedToolBudget(getRunTrace(chatId).slice(traceBefore))) {
    events.onText(`\n\n${labels.dispatchHint}\n`);
  }

  // The loop surfaces a failure on the run cell rather than throwing, so read it here
  // and clear it — otherwise the NEXT turn of this chat would re-report it.
  const settled = getRunSnapshot(chatId);
  if (settled.error) {
    events.onError(settled.error, settled.errorAction);
    clearRunError(chatId);
  }
}
