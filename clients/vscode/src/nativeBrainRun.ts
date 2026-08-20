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
  resolveRunConfirm,
  runBrainLoop,
  stopRun,
  toolSpecsFor,
  subscribeRun,
  type BrainAction,
  type BrainRunPersistence,
  type BrainRunSnapshot,
  type BrainStreamFn,
  type BrainToolSpec,
  type BrainTransport,
  type BrainTraceEvent,
  type ChatCompletionMessage,
  type ChatErrorAction,
  type ChatMode,
  type EvermindRunHooks,
} from "@seanhogg/builderforce-brain-embedded";
import { describeTool, type ToolDef } from "./fileTools";
import { evaluatePolicyGate, renderPolicyDirectives, type PolicyGate } from "./policy";

/**
 * The native surface renders MARKDOWN, not the webview's `<BrainTimeline>`, so the
 * loop's observable state has to be translated into a linear stream of calls. This is
 * the same four-event contract the participant has always consumed.
 */
export interface NativeRunEvents {
  onText(delta: string): void;
  onToolStart(label: string): void;
  onToolResult(label: string, ok: boolean): void;
  /**
   * The run failed. `action` is the SHARED entitlement verdict the loop already derived
   * from the gateway's structured fields (expired session / needs a plan / needs a
   * card), so the participant can offer the fix as a link instead of only restating the
   * sentence — the markdown twin of the webview's error banner.
   */
  onError(message: string, action: ChatErrorAction | null): void;
}

/** A tool call the loop paused on, waiting for an explicit human decision. */
export interface NativeApprovalRequest {
  /** Tool the model asked to run. */
  name: string;
  args: Record<string, unknown>;
  /** Human one-liner for the modal — "edit src/app.ts", "run: pnpm test". */
  label: string;
  /**
   * Set only when a GOVERNANCE gate (not the ordinary write-confirm) is what paused
   * the call, carrying the gate's reason. The host phrases those two prompts
   * differently, so the distinction has to survive to the modal.
   */
  gateReason?: string;
}

/** Prose the HOST owns, because it must be localized through `vscode.l10n.t()`. */
export interface NativeRunLabels {
  /** Appended when the run burned its whole tool-iteration budget without finishing. */
  dispatchHint: string;
  /** Handed to the model in place of a call a governance `block` gate refused. */
  blockedByPolicy(reason: string): string;
}

export interface NativeBrainRunOptions {
  /**
   * The Brain chat this turn belongs to. Also the run store's cell key, so a run
   * survives anything that happens on the host side while it is in flight. Pass a
   * unique NEGATIVE id (see {@link unlinkedRunId}) for a turn with no server chat.
   */
  chatId: number;
  /** The whole system prompt, already assembled by the host (persona + grounding +
   *  editor context + limbic + governance directives). */
  systemPrompt: string;
  /** Prior turns of this session, oldest first. */
  seed: ChatCompletionMessage[];
  /** The user turn that triggered this run. */
  userTurn: string;
  /** Local file tools + cognition + the gateway's platform catalog. */
  tools: ToolDef[];
  /** Workspace root; '' when no folder is open (the file tools are then absent). */
  root: string;
  /** The chat's project — enables the loop's code-change→ticket backstops. */
  projectId?: number;
  model?: string;
  modelStrict?: boolean;
  routingMode?: "auto" | "byo_pool";
  /** Conversation vs execution (0409). Defaults to `work` inside the loop. */
  chatMode?: ChatMode;
  permissionMode: "ask" | "acceptEdits";
  /** Compiled governance gates, enforced at the tool seam exactly as the cloud does. */
  policyGates?: PolicyGate[];
  /** Ask the human. Resolves true to run the call, false to skip it. */
  approve(request: NativeApprovalRequest): Promise<boolean>;
  /** Transport-bound streaming completion fn. */
  stream: BrainStreamFn;
  /**
   * Where the loop writes its intermediate turns. Defaults to
   * {@link transientRunPersistence} — the native participant persists the WHOLE turn
   * once, after the loop, so the loop's own writes must not double-post.
   */
  persistence?: BrainRunPersistence;
  /** Project-Evermind hooks: recall, the memory-first answer, the answer cache. */
  evermind?: EvermindRunHooks;
  /** Tool-iteration ceiling for this run. */
  maxIterations?: number;
  signal: AbortSignal;
  labels: NativeRunLabels;
  events: NativeRunEvents;
}

/**
 * The header that tells the gateway WHICH surface spent the tokens, so BYO / free
 * metering attributes an editor turn to the editor. It used to be set by the deleted
 * SDK adapter through an environment variable; it now rides the transport, which is
 * the only place both chat surfaces can share it.
 */
export const SURFACE_HEADER = "x-builderforce-surface";
export const SURFACE_VALUE = "vsix";

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
    fetch: (input, init) =>
      fetchImpl(input, {
        ...init,
        headers: { ...((init.headers as Record<string, string>) ?? {}), [SURFACE_HEADER]: SURFACE_VALUE },
      }),
  };
  return (opts, handlers) => streamChatCompletion({ ...opts, transport }, handlers);
}

/** Coerce a tool-call argument bag to a plain record. */
function argsRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * A human one-liner for a tool call — the text that reaches the approval modal and the
 * `✓`/`✗` progress lines.
 *
 * Local tools get {@link describeTool}'s path-aware phrasing; a REMOTE (gateway MCP)
 * tool is named by its verb plus whatever subject its arguments carry. Both used to be
 * re-derived inside the deleted SDK adapter; this is the one definition.
 */
export function toolLabel(defs: readonly ToolDef[], name: string, args: Record<string, unknown>): string {
  const def = defs.find((candidate) => candidate.name === name);
  if (!def?.remote) return describeTool(name, args);
  const verb = name.replace(/^builtin_/, "").replace(/_/g, " ");
  const subject =
    (typeof args.title === "string" && args.title) ||
    (typeof args.name === "string" && args.name) ||
    (typeof args.id !== "undefined" && `#${String(args.id)}`) ||
    "";
  return subject ? `${verb}: ${subject}` : verb;
}

/**
 * The extension's `ToolDef` shape expressed as the brain core's {@link BrainAction} —
 * the ONE place that mapping lives, so the model is shown identical names, descriptions
 * and schemas whether the run is a real chat turn or an offline harness scenario.
 * `run` is supplied by the caller because WHO executes differs (the real dispatcher
 * here, a canned responder in the harness) while WHAT is advertised must not.
 */
export function toolDefActions(
  defs: readonly ToolDef[],
  run: (name: string, args: unknown) => Promise<unknown>,
): BrainAction[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters,
    mutates: def.mutating,
    run: (args: unknown) => run(def.name, args),
  }));
}

/** Advertise the host's tool defs to the model, through the ONE shared mapping. */
export function nativeToolSpecs(defs: readonly ToolDef[]): BrainToolSpec[] {
  // Execution goes through `createNativeRunTool`, never the action's own `run` — the
  // action shape exists here only so the spec mapping stays shared with every host.
  return toolSpecsFor(toolDefActions(defs, async () => ({ ok: false, error: "not dispatched here" })));
}

/**
 * Whether a pending call must pause for a human. TRUE for a governance
 * `require-approval` gate (always — an "acceptEdits" preference cannot waive a
 * compiled policy) and for a mutating tool while the permission mode is `ask`.
 *
 * Pure, so the loop can consult it synchronously; the actual modal is resolved
 * asynchronously off the run's pending-confirm channel.
 */
export function nativeNeedsConfirm(
  defs: readonly ToolDef[],
  permissionMode: "ask" | "acceptEdits",
  gates: readonly PolicyGate[] | undefined,
): (req: { name: string; args: unknown }) => boolean {
  return ({ name }) => {
    if (evaluatePolicyGate(gates, name).action === "require-approval") return true;
    if (permissionMode === "acceptEdits") return false;
    const def = defs.find((candidate) => candidate.name === name);
    // Fail safe: a tool we don't recognise is treated as mutating.
    return def ? def.mutating : true;
  };
}

/** What to ask the human about a paused call. */
export function approvalRequestFor(
  defs: readonly ToolDef[],
  gates: readonly PolicyGate[] | undefined,
  name: string,
  args: unknown,
): NativeApprovalRequest {
  const record = argsRecord(args);
  const decision = evaluatePolicyGate(gates, name);
  return {
    name,
    args: record,
    label: toolLabel(defs, name, record),
    ...(decision.action === "require-approval" ? { gateReason: decision.reason } : {}),
  };
}

/**
 * A tool result the loop can reason about. The host's `ToolDef.execute` returns a JSON
 * STRING; handing that straight to the loop would hide `{ ok:false }` from the failure
 * detector and defeat the deterministic chat↔work auto-link, which reads the created
 * row's `id` off an OBJECT. Parse when it parses, keep the text when it doesn't.
 */
export function parseToolOutput(raw: string): unknown {
  const text = raw?.trim() ?? "";
  if (!text || (text[0] !== "{" && text[0] !== "[")) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

/**
 * The loop's tool dispatcher for this host: enforce the governance gates at the tool
 * seam, run the real implementation, and narrate both ends onto the chat stream.
 *
 * A `block` gate never reaches the implementation — the model gets a refusal it can
 * recover from, exactly as the cloud loop's seam behaves. `require-approval` is not
 * handled here: it is a PAUSE, and pausing is the run store's confirm channel.
 */
export function createNativeRunTool(opts: {
  defs: readonly ToolDef[];
  root: string;
  gates?: readonly PolicyGate[];
  events: Pick<NativeRunEvents, "onToolStart" | "onToolResult">;
  labels: Pick<NativeRunLabels, "blockedByPolicy">;
}): (name: string, args: unknown) => Promise<unknown> {
  return async (name, args) => {
    const record = argsRecord(args);
    const label = toolLabel(opts.defs, name, record);
    const decision = evaluatePolicyGate(opts.gates, name);
    if (decision.action === "block") {
      const message = opts.labels.blockedByPolicy(decision.reason);
      opts.events.onToolResult(label, false);
      return { ok: false, error: message };
    }
    const def = opts.defs.find((candidate) => candidate.name === name);
    if (!def) return { ok: false, error: `Unknown tool: ${name}` };
    opts.events.onToolStart(label);
    try {
      const out = await def.execute(record, opts.root);
      opts.events.onToolResult(label, true);
      return parseToolOutput(out);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      opts.events.onToolResult(`${label} — ${message}`, false);
      return { ok: false, error: message };
    }
  };
}

/**
 * Turn the run store's observable state into the linear markdown stream the native
 * chat renders.
 *
 * Two sources have to be reconciled without ever printing the same sentence twice.
 * `streamingText` is the live buffer the user watches fill; `appended` is what the loop
 * durably committed. Normally the second is the settled form of the first, so a
 * committed message whose text was already streamed is skipped — but a MEMORY-FIRST
 * answer never streams at all (that is the whole point: no model call), so it arrives
 * only as an appended message and must be printed. Tracking both is what makes the two
 * cases one code path.
 */
export function createStreamRelay(events: Pick<NativeRunEvents, "onText">): (snapshot: BrainRunSnapshot) => void {
  let lastStreaming = "";
  const seenIds = new Set<number>();
  const alreadyShown = new Set<string>();
  return (snapshot) => {
    const text = snapshot.streamingText;
    if (text !== lastStreaming) {
      if (text.startsWith(lastStreaming)) {
        const delta = text.slice(lastStreaming.length);
        if (delta) events.onText(delta);
      } else {
        // The turn ended (buffer cleared) or restarted with different content. Whatever
        // was on screen is now settled — remember it so its committed twin is not
        // reprinted below.
        if (lastStreaming.trim()) alreadyShown.add(lastStreaming.trim());
        if (text) events.onText(text);
      }
      lastStreaming = text;
    }
    for (const message of snapshot.appended) {
      if (!message || seenIds.has(message.id)) continue;
      seenIds.add(message.id);
      const content = typeof message.content === "string" ? message.content.trim() : "";
      if (!content) continue;
      // Committed while still on screen, or already settled — the user has read it.
      if (content === lastStreaming.trim() || alreadyShown.has(content)) {
        alreadyShown.add(content);
        continue;
      }
      alreadyShown.add(content);
      events.onText(`\n\n${content}\n`);
    }
  };
}

/**
 * Did the run burn its entire tool-iteration budget? True when the loop had to force a
 * final answer with tools withdrawn, or gave up outright. The native surface appends a
 * dispatch hint on that outcome — a long IDE task that hit the ceiling is telling the
 * user it belongs on an agent, not in a chat turn.
 */
export function exhaustedToolBudget(events: readonly BrainTraceEvent[]): boolean {
  return events.some(
    (e) =>
      (e.label === "llm.complete" && (e.args as { forcedFinish?: unknown } | undefined)?.forcedFinish === true) ||
      (e.category === "error" && e.label === "agent.loop"),
  );
}

/**
 * The loop persists every intermediate turn through this port. The native participant
 * writes the WHOLE exchange ONCE after the run (that single write is also what triggers
 * the server-side Evermind learn gate), so the in-run writes must not reach the server
 * or the conversation would be stored twice. Ids are negative: nothing downstream can
 * mistake one for a real `brain_messages` row.
 */
export function transientRunPersistence(): BrainRunPersistence {
  let nextId = -1;
  return {
    async sendMessages(_chatId, messages) {
      const at = new Date().toISOString();
      return messages.map((m) => ({
        id: nextId--,
        role: m.role,
        content: m.content,
        metadata: m.metadata ?? null,
        seq: 0,
        createdAt: at,
      }));
    },
  };
}

/**
 * Cell id for a turn that has no server-side Brain chat (chat creation failed — the
 * platform is unreachable). Negative and unique per run, so such a turn still gets its
 * own run cell instead of colliding with a real chat or with another unlinked turn.
 */
let unlinkedSeq = 0;
export function unlinkedRunId(): number {
  unlinkedSeq += 1;
  return -unlinkedSeq;
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
    permissionMode,
    events,
    labels,
    signal,
  } = opts;

  const runTool = createNativeRunTool({ defs: tools, root, ...(policyGates ? { gates: policyGates } : {}), events, labels });
  // Governance rides in TWO places, both of them here: the gates are rendered as binding
  // system-prompt lines so the model is bound by the same policy on every surface, and
  // they are HARD-enforced at the tool seam above. Rendering it here (rather than in the
  // caller) keeps the two halves of one capability from drifting apart.
  const governance = renderPolicyDirectives(policyGates);
  const systemPrompt = governance ? `${governance}\n\n${opts.systemPrompt}` : opts.systemPrompt;
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
      ...(opts.projectId != null ? { projectId: opts.projectId } : {}),
      ...(opts.evermind ? { evermind: opts.evermind } : {}),
      ...(opts.maxIterations ? { maxIterations: opts.maxIterations } : {}),
      runTool,
      needsConfirm: nativeNeedsConfirm(tools, permissionMode, policyGates),
      stream: opts.stream,
      persistence,
      seed: opts.seed,
      userTurn: opts.userTurn,
    });
  } finally {
    // Deliver anything the last emit carried before we stop listening.
    relayText(getRunSnapshot(chatId));
    unsubscribe();
    signal.removeEventListener("abort", onAbort);
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
