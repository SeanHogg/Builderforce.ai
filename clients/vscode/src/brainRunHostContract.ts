/**
 * The run host's CONTRACT — what the editor supplies a run (`BrainRunHostPorts`) and what
 * the host offers the panels (`BrainRunHost`). Split from `brainRunHost.ts`, which is the
 * implementation; that module re-exports every name here, so importers are unchanged.
 * Types, plus the owner's display name.
 */

import type { PrefetchPort } from "@builderforce/prefetch";
import type {
  AvoidedRunCall,
  BrainRunOutcome,
  BrainRunPersistence,
  BrainStreamFn,
  ChatInputAttachment,
  EvermindRunHooks,
  ModelFallbackEvent,
  ModelPreflightResult,
  ServedRead,
} from "@seanhogg/builderforce-brain-embedded";
import type { LocalRuntimeProbe } from "@builderforce/local-inference";
import type { RunKnowledgeLog } from "@builderforce/agent-tools";
import type { ToolDef } from "./fileTools";
import type { NativeRunLabels } from "./nativeBrainRun";
import type { PolicyGate } from "./policy";
import type { RunDirectives } from "./hooks/runHooks";
import type { RunSink, WebviewRunStart } from "./brainRunHostProtocol";
import type { ChildControls, ChildOwner } from "./childRunSpawner";
import type { ChildApprover } from "./childApprovalRelay";
import type { EditorRunSettings } from "./stageModels";
import type { RunOutcomeReport } from "@seanhogg/builderforce-brain-embedded";

/** The top-level owner's name, as the chat shows it (a brand, not translated). */
export const OWNER_NAME = "BuilderForce";

/** How a settled run's note is committed: the chat's Memory switch, and the project the
 *  run STARTED in — so switching projects mid-run does not move its memory. */
export interface RunNoteOptions {
  memory: boolean;
  projectId?: number;
}

export interface ToolRunInfo {
  chatId: number;
  name: string;
  args: Record<string, unknown>;
  mutating: boolean;
  remote: boolean;
  ok: boolean;
}

/** What the editor supplies to a run; every member is host-side, none needs the panel. */
export interface BrainRunHostPorts {
  /**
   * Local file tools + cognition + the gateway's platform catalog, for a project.
   *
   * `children` is THIS run's handle on its sub-agents and `signal` its Stop — built here
   * (not by the port) because only the run knows who it is: its key, its chat, its depth.
   */
  tools(projectId: number | undefined, children: ChildControls, signal: () => AbortSignal | undefined, opts: { memory: boolean; audit?: { auditId: string; runId: string } }): Promise<readonly ToolDef[]>;
  /** Workspace root the local tools resolve against; '' when no folder is open. */
  workspaceRoot(): string;
  /**
   * The transport-bound streamer for the CURRENT route (gateway or on-device).
   * `onFallback` is told when Hybrid's pick failed and the turn was answered with Auto.
   */
  stream(onFallback?: (event: ModelFallbackEvent) => void): Promise<BrainStreamFn>;
  /** The live on-device runtimes, asked only when a turn moves onto a local model so the
   *  window gate packs for that runtime's real window. Omitted ⇒ the catalog row. */
  localProbes?(): Promise<readonly LocalRuntimeProbe[]>;
  /** Where the loop persists its turns — the same Brain store the panel reads. */
  persistence: BrainRunPersistence;
  /**
   * PRD 36: which SERVER chat a run's local chat is — binding it first when signed in —
   * and its client id. `serverChatId: null` = unbound: no chat id leaves the machine.
   * Omitted ⇒ the run's chat id is itself a server chat.
   */
  chatIdentity?(chatId: number): Promise<{ serverChatId: number | null; clientChatId?: string }>;
  /** PRD 36: wrap the run's streamer so every call lands in the chat's usage ledger. */
  recordUsage?(stream: BrainStreamFn, run: { chatId: number; runKey: number; mode?: "chat" | "work" }): BrainStreamFn;
  /** The editor's per-run settings — stage models, pipeline routing, the USD cap
   *  (`editorRunSettings.ts`). Read once per run; omitted ⇒ none apply. */
  runSettings?(): Promise<EditorRunSettings>;
  /** PRD 36 / WS-R: how a run ended, under the id its usage rows carry — beside the
   *  chat's usage ledger, for the pipeline route report — and, later, whether the run's
   *  PreFetch decision was accepted (the report's gate accuracy). */
  recordRunOutcome?(run: { chatId: number }, end: RunOutcomeReport): Promise<void>;
  /** Project-Evermind hooks for a project (recall, memory-first answer, cache), tiered on
   *  the conversation when it has a server chat (`null` = none). */
  evermind(projectId: number, serverChatId: number | null): EvermindRunHooks | undefined;
  /**
   * The api-assembled platform context for this turn — strategy / PRD / governance /
   * the project's durable memory (facts) / prior Evermind lessons — rendered as a
   * system-prompt section, or '' when there is none. Fetched once per run at loop
   * start with the user's request as the recall query. This is the block the native
   * participant already carried and the webview run did not: without it a run in the
   * panel started every task with no memory of what earlier runs had learned.
   */
  runContext?(projectId: number, serverChatId: number | null, query: string): Promise<string>;
  /**
   * The tenant's effective governance gates for a run — the same compiled rows the
   * cloud and on-prem loops enforce. Resolved once per run at loop start; a throw
   * refuses the run (fail-closed, as the server is). Omitted ⇒ no gates.
   */
  policyGates?(projectId: number | undefined): Promise<readonly PolicyGate[]>;
  /**
   * The workspace's committed rules + hooks (`.builderforce/rules.md`, `hooks.json`) for
   * ONE run — fresh per run, since the hooks hold the run's state. A sub-agent asks with
   * `subagent` and gets the tool hooks only. Omitted ⇒ none.
   */
  directives?(scope: "run" | "subagent"): Promise<RunDirectives | undefined>;
  labels: Pick<NativeRunLabels, "blockedByPolicy">;
  /** A chat gained a turn — refresh the Sessions tree. */
  onChatsChanged?(): void;
  /** A tool call finished (local or platform) — refresh what it may have changed. */
  onToolRun?(info: ToolRunInfo): void;
  /** The set of live runs changed — feed the Sessions tree's status overlay. */
  onRunsChanged?(state: { running: number[]; awaiting: number[] }): void;
  /**
   * A run finished with local activity — write its `.builderforce/` note and, when the
   * chat's Memory switch is on (`memory`), what it learned and the code map of what it
   * found into the project's facts.
   */
  sessionNote?(chatId: number, run: RunKnowledgeLog, opts: RunNoteOptions): Promise<void> | void;
  /**
   * What recent runs in this workspace did, read NOW. The panel builds its system
   * prompt once, when it opens; without this every later run in that panel started
   * from the notes of the runs before the panel opened, never from the run that just
   * finished. Joined to the run-context block — the volatile per-run seam — so the
   * system prompt itself stays a stable, cacheable prefix. Omitted ⇒ none.
   */
  recentActivity?(): Promise<string>;
  /**
   * PRD 35 E2: the task context pack — the files the request names, the chat's tickets
   * and runs, git state per checkout and the matching `codemap:` facts — built once
   * before turn 1 with no model call (`contextPack/buildContextPack.ts`). Its block is
   * ALWAYS the run's volatile turn context; its hint widens the Evermind recall; the files
   * it inlined whole are the run's reads already. Omitted ⇒ none.
   */
  contextPack?(input: { projectId?: number; serverChatId: number | null; request: string; memory: boolean }): Promise<RunContextPack | undefined>;
  /**
   * The deterministic-first PreFetch port (`prefetch/vscodePrefetchPort.ts`): the run's
   * gate ANSWERS a request the workspace settles without a model ("where is X defined?"
   * from the symbol index) and PREFETCHES facts into the volatile turn context. Omitted ⇒
   * every request goes to the model as before.
   */
  prefetch?: PrefetchPort;
  /** Record a model call a PreFetch ANSWER avoided, beside the chat's usage ledger. Omitted ⇒ none. */
  recordAvoidedCall?(run: { chatId: number }, call: AvoidedRunCall): Promise<void>;
  /**
   * PRD 35 E7: the BYO health check before turn 1 — unresolved accounts in the gateway
   * header's `provider:reason` form, shown on the run's banner before any work.
   */
  modelPreflight?(): Promise<ModelPreflightResult | undefined>;
  /**
   * The workspace's SHAPE as it is NOW — scan map, repo map, symbol index; never the run
   * notes (those ride {@link recentActivity}). The panel builds its prompt once, when it
   * opens, often before indexing finished; swapping the block per run gives each run the
   * current map, and the prompt's bytes change only when the workspace was rescanned, so
   * it stays a cacheable prefix. Omitted ⇒ the prompt's own copy is used as sent.
   */
  grounding?(): Promise<string | undefined>;
  /** Report a settled code-changing run's outcome to learned routing. Best-effort. */
  reportOutcome?(outcome: BrainRunOutcome): Promise<unknown>;
  /**
   * PRD 35 E3: the run's default checkout when the open folder CONTAINS checkouts —
   * resolved ONCE per run from the request, the project's repositories and the
   * checkouts on disk (`runDefaultRepo.ts`). Never throws into the run; undefined ⇒ none.
   */
  defaultRepo?(input: { projectId?: number; request?: string }): Promise<string | undefined>;
  /**
   * A run SETTLED — finished, failed or stopped: release what it held outside the loop
   * (its background shell jobs — a dev server must not outlive the run). Never throws.
   */
  settleRun?(runKey: number): void;
}

/** What {@link BrainRunHostPorts.contextPack} hands a run. */
export interface RunContextPack {
  block: string;
  recallHint: string;
  /** The focus files the block inlined WHOLE — recorded as the run's reads. */
  servedReads?: readonly ServedRead[];
}

export interface BrainRunHost {
  /** Run one turn. Resolves when the loop has settled (like `startRun`). */
  start(payload: WebviewRunStart): Promise<void>;
  stop(chatId: number): void;
  confirm(chatId: number, ok: boolean): void;
  clearError(chatId: number): void;
  /** The panel's copy of this run fell out of step: resend it whole (`runRelay.ts`). */
  resync(chatId: number): void;
  /**
   * The Auto-mode switch moved for ONE chat — the one whose panel it was flipped in.
   *
   * Deliberately per-chat, and the reason is the whole point of runs living out here:
   * several chats execute AT ONCE, and closing or switching away from a tab no longer
   * stops the work behind it. While this applied to every live run, "turn Auto on so
   * this refactor stops asking me" also silently answered YES to whatever a DIFFERENT
   * chat happened to be parked on — a delete, a push, a base-branch commit — in a tab
   * the user was not even looking at. A switch in one conversation must not approve an
   * action in another.
   *
   * Also called when a panel BINDS to a chat, not only when the switch is toggled: in
   * reuse mode one panel moves between chats, so a chat parked on a confirm must be
   * answered the moment the user comes back to it with Auto already on — otherwise the
   * per-chat scoping would strand exactly the run the user returned to unblock.
   */
  setAutoApprove(chatId: number, on: boolean): void;
  /** Put the person's words in front of a RUNNING run's next turn — the chat's own run
   *  (instead of queueing behind it) or one of its sub-agents. A run that is no longer
   *  running takes them as its next turn instead: a message is never dropped. Image
   *  attachments ride along as vision parts of that turn. */
  steer(runKey: number, text: string, attachments?: ChatInputAttachment[]): void;
  /**
   * Sub-agent controls for a run this host did NOT start — the native chat participant.
   * Its children run here, as ordinary runs; it cannot be woken (its turn belongs to the
   * editor's chat view), so their reports wait in its inbox for its next turn. With
   * `approve`, its children's write prompts are asked through it (the native view cannot
   * render a run cell's confirm).
   */
  childControls(owner: ChildOwner, base: Omit<WebviewRunStart, "chatId">, approve?: ChildApprover): ChildControls;
  /** Is the run key claimed - setting up, running or unwinding? Another path (the native chat
   *  participant) asks before it starts a run of its own on the same key. */
  isBusy(runKey: number): boolean;
  /** Watch the runs from a panel. The panel is brought up to date immediately. */
  attach(sink: RunSink): () => void;
  dispose(): void;
}
