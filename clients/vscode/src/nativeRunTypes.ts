/**
 * The native chat participant's run CONTRACT - what the participant hands `runNativeBrain`
 * (`NativeBrainRunOptions`), what it asks the person (`NativeApprovalRequest`), the prose
 * the host owns (`NativeRunLabels`) and how the run's output reaches the chat
 * (`NativeRunEvents`). Types only. Split from `nativeBrainRun.ts`, which re-exports every
 * name here, so importers are unchanged. No `vscode` import.
 */

import type { RunKnowledgeLog } from "@builderforce/agent-tools";
import type {
  ChatCompletionMessage,
  BrainRunPersistence,
  BrainRunRequest,
  BrainStreamFn,
  ChatErrorAction,
  ChatMode,
  EvermindRunHooks,
} from "@seanhogg/builderforce-brain-embedded";
import type { ToolDef } from "./fileTools";
import type { PolicyGate } from "./policy";
import type { EditorRunSettings } from "./stageModels";
import type { RunDirectives } from "./hooks/runHooks";

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
  /** Appended when the loop stopped the run itself — its last few tool calls all failed
   *  and it had to be forced to answer (or gave up outright). */
  dispatchHint: string;
  /** Handed to the model in place of a call a governance `block` gate refused. */
  blockedByPolicy(reason: string): string;
  /** Said when the chat already has a run in flight that another path started: this turn
   *  claimed nothing, so it neither runs nor settles. Omitted ⇒ it returns silently. */
  alreadyRunning?: string;
}

export interface NativeBrainRunOptions {
  /**
   * The Brain chat this turn belongs to. Also the run store's cell key, so a run
   * survives anything that happens on the host side while it is in flight.
   */
  chatId: number;
  /**
   * The SERVER chat this turn's server-addressed work names (PRD 36): `chatId` is a
   * local view key that never leaves the machine. `null` = an unbound local chat (no
   * chat id is sent); omitted = `chatId` is itself a server chat.
   */
  serverChatId?: number | null;
  /** The local chat's client id — diagnostics on the gateway metadata only. */
  clientChatId?: string;
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
  /** Stage models, pipeline routing and the USD cap (`editorRunSettings.ts`). */
  runSettings?: EditorRunSettings;
  /** How the run ended, for the chat's usage ledger (the pipeline route report). */
  recordRunOutcome?: BrainRunRequest["recordRunOutcome"];
  /** A model call a PreFetch ANSWER avoided, for the chat's usage ledger. */
  recordAvoidedCall?: BrainRunRequest["recordAvoidedCall"];
  /** Conversation vs execution (0409). Defaults to `work` inside the loop. */
  chatMode?: ChatMode;
  permissionMode: "ask" | "acceptEdits";
  /** Compiled governance gates, enforced at the tool seam exactly as the cloud does. */
  policyGates?: PolicyGate[];
  /** The workspace's committed rules + hooks (`.builderforce/`), when it has any. */
  directives?: RunDirectives;
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
  /**
   * The task context pack's fields (PRD 35 E2 / E7) — the SAME fields the panel's run host
   * builds (`runSetup.ts` `runContextFields`): the pack's block as the turn context, the recall
   * hint, the files it served whole, and the BYO preflight.
   */
  runContext?: Pick<BrainRunRequest, "turnContext" | "recallHint" | "servedReads" | "modelPreflight">;
  /** The run's default checkout, read per call, and the wait for it to resolve (PRD 35 E3). */
  defaultRepo?: () => string | undefined;
  repoReady?: Promise<void>;
  /** The run SETTLED — finished, failed or stopped: release what it held outside the loop
   *  (its background shell jobs, `localShellJobs.ts`). Called once, whatever the outcome. */
  settleRun?: (runKey: number) => void;
  /** Whether another path holds the chat's run - the run host, which also counts the window
   *  while a run is still setting up. Asked with `isRunning` before this call claims the key. */
  isBusy?: (chatId: number) => boolean;
  /** The deterministic-first PreFetch port ("where is X defined?" answered with no model
   *  call, and every registry row after it) — the same port the panel's run host passes. */
  prefetch?: BrainRunRequest["prefetch"];
  /** The run's record of what it did and read — the per-turn ledger, and what the caller
   *  commits at run end (`recordEditorRunEnd`). Omitted ⇒ the loop keeps its own. */
  knowledge?: RunKnowledgeLog;
  signal: AbortSignal;
  labels: NativeRunLabels;
  events: NativeRunEvents;
}
