/**
 * contract — THE contract between the one agent and every entry point (PRD 35 §3.2).
 *
 * An adapter supplies PORTS and nothing else: where the model runs, what the surface
 * can do, where state lives, where events go, how people are reached, what the user
 * steered in, and the context pack. It never supplies a loop, a branch on behaviour or
 * a policy — that is the agent's job. `RunPolicy.entryPoint` is a telemetry label only,
 * NEVER a switch.
 *
 * Every type here is plain data. A run's state crosses a process boundary (a Durable
 * Object tick, a Worker invocation, a VS Code extension host restart) as JSON, so it
 * has to survive a round trip.
 *
 * The types that already have a home are REUSED, never redefined: `RunPolicyState`
 * (`@builderforce/run-policy`), `RunKnowledgeState` and `PolicyGate`
 * (`@builderforce/agent-tools`), `CostLeverId` (`@builderforce/cost-levers`).
 *
 * The finish-gate counters are owned by `policy/finish` (WS2d's port of
 * `cloudAgent/finishGates.ts`) and re-exported here, never restated. The guard state
 * is named here — WS2d's `policy/guards` snapshots into it — because it gathers several
 * owners' shapes (`@builderforce/run-guards`, `@builderforce/run-policy`) into the one
 * slice a step boundary carries.
 */

import type {
  CapabilityProvider,
  ToolDefinition,
  PolicyGate,
  ToolSchema,
} from "@builderforce/agent-tools";
import type { CostLeverId } from "@builderforce/cost-levers";
import type { RunPolicyEvent, RunPolicyOptions, RunPolicyState } from "@builderforce/run-policy";
import type { EntryPoint } from "@builderforce/learned-routing";
import type { DeliveryLedger, PlatformTools, TurnInterruption } from "./surface.js";
import type { RunEvent } from "./runEvents.js";
import type { RunState } from "./runStateTypes.js";
import type { ModelTransport, RunMessage, RunPart } from "./contractModel.js";

// The run's trace events and its state types live in their own modules; one import here gives a consumer the whole contract.
export * from "./runEvents.js";
export * from "./runStateTypes.js";
export * from "./contractModel.js";

// The reused types, re-exported so one import gives a consumer the whole contract.
export type { CapabilityProvider, PolicyGate, RunKnowledgeState } from "@builderforce/agent-tools";
export type { CostLeverId } from "@builderforce/cost-levers";
export type { RunPolicyState } from "@builderforce/run-policy";
export type { FinishGateState } from "./policy/finish/gates.js";

// ── The task ──────────────────────────────────────────────────────────────────

/** A file, image or document handed to the run. The adapter has already fetched it. */
export interface RunAttachment {
  /** The name the model sees. */
  name?: string;
  /** The MIME type when the surface knows it. */
  mimeType?: string;
  /** Inline content — text, or a data URL for an image. */
  content?: string;
  /** A location the surface can read, when the content is not inlined. */
  url?: string;
  /** The size in bytes, when the surface knows it. */
  bytes?: number;
}

export interface RunTask {
  runId?: string;                  // the adapter's id for this run (execution / client run id) — the §8.2 row's run id
  prompt: string;
  ticketId?: number; chatId?: number | string; projectId?: number;
  persona?: string;                // compiled persona brief
  request?: string;                // the user's own request, when `prompt` carries more than it (the stall gate reads this)
  agentName?: string;              // who the run answers as (the forced synthesis names it)
  attachments?: RunAttachment[];
  dispatch: { source: 'board-sweep' | 'lane-entry' | 'chat' | 'manual' | 'ceremony' | 'subagent'; approvalId?: string; parentRunId?: string };
  workspace?: { defaultRepo?: string; focusPaths?: string[] };  // resolved by the adapter (§6.10); git + shell default to defaultRepo
  /** The opening rows when the surface assembles its own prompt (system blocks, prior conversation, the user turn). Absent ⇒ one system row from the persona and prompt. */
  transcript?: RunMessage[];
}

// ── The policy ────────────────────────────────────────────────────────────────

export interface RunPolicy {
  entryPoint: EntryPoint;          // telemetry label only — NEVER branched on for behaviour; the list is the wire contract's (`@builderforce/learned-routing`)
  toolScope: 'ticket' | 'chat-reply' | 'chat-work' | 'canvas' | 'subagent';
  role: string;                    // tier ladder, verify phase
  levers: readonly CostLeverId[];   // @builderforce/cost-levers owns the ids — A3, C5, C7, D1, D7, D8 …
  budgets: {
    steps?: number;
    tokens?: number;
    /** Tokens held back for the reply when compaction sizes the transcript. Absent ⇒ the host-neutral floor (`compactionReserve`). A surface whose replies are bounded far below it says so here (≤ about a quarter of its smallest window). A run with `modelHandoff` ignores it: its reserve follows the serving model's window. */
    reserveTokens?: number;
    /** The run's spend cap in USD (priced turns only, `ModelUsage.pricedMc`): the model is told once at 80% to converge, and the run stops with a contained answer at the cap. Absent or 0 ⇒ no cap. */
    usd?: number;
  };
  /**
   * The tools that CHANGE code. The first call to one in an analysis (`plan`) turn is re-asked of the coding model with a brief
   * naming the change the planner was about to make, unless the model policy declines (a pin, a lock). Absent ⇒ no re-ask.
   */
  codeChangeTools?: readonly string[];
  pinnedModel?: string;
  inference: 'local-only' | 'hybrid' | 'specific';
  verify: 'declared-checks' | 'branch-ci' | 'none';
  signoff?: { roleKey: string; laneKey?: string };   // finish blocked until signed off
  approvalGates: PolicyGate[];                        // in-run acts needing an approver — reuse @builderforce/agent-tools spec.ts:118
  delegation: { requested: boolean; readsBeforeNudge: number };  // requested = asksForSubagents(prompt) unless declined; default nudge after 6 reads
  /** How the model policy hands a run between models, where the surface's session has a say (routed-around models, strict failover). Absent ⇒ the policy's defaults. */
  modelOptions?: Pick<RunPolicyOptions, 'strictPin' | 'pinReleasable' | 'lockAfterFirstSuccess' | 'preferProvenFailover' | 'strictFailover' | 'excludeModels'>;
  /**
   * How the run's model hand-off starts (additive, optional): whether `pinnedModel` is an explicit
   * pin (asked strictly) or a soft seed, the delegated role the phase rule reads, and the per-phase
   * models. Absent ⇒ a soft pin on a coding run, exactly as before.
   */
  /**
   * What a stall that has nothing left to try does: `finish` ends the run with what it said and the notice (whatever it
   * committed still ships; a surface that lands runs wants this), `fail` stops it unfinished. Default `fail`.
   */
  stallExhausted?: "finish" | "fail" | "note";
  /**
   * Re-pack the run's context for the incoming model's window when a stall fails it over onto another model, and tell the model
   * it took over (additive; absent => no hand-off packing, and the compaction is what it always was). Present, the run can land on
   * ANY window, so its reply reserve follows the model now serving: the turn's own reply ceiling within a quarter of that window,
   * and the request's `maxTokens` is held to it (`replyReserve`, policy/compaction/reserve). Nothing to configure.
   */
  modelHandoff?: Record<string, never>;
  modelStart?: {
    strict?: boolean; delegatedRole?: string; phaseModels?: RunPolicyOptions["phaseModels"];
    /** The run-start model when it is a soft seed rather than `pinnedModel`. */
    model?: string;
    /** Start the hand-off as the plain policy (no lock after first success, no releasable pin) — an addressed reply's. */
    plain?: boolean;
    /** The phase a PLAIN start begins in: a delegated slice or a quick run starts coding, everything else plans. Absent ⇒ the policy's own. */
    startPhase?: RunPolicyOptions["startPhase"];
  };
}

// ── The ports ─────────────────────────────────────────────────────────────────

/** Where the run's state lives. */
export interface RunStore {
  /** The state to resume from, or nothing for a fresh run. */
  load(): Promise<RunState | undefined> | RunState | undefined;
  /** Persist the state at a step boundary, so a later tick resumes from it. */
  save(state: RunState): Promise<void> | void;
  /** The run-end write-back: the consolidated memory the run produced. */
  commitMemory?(consolidated: unknown): Promise<void> | void;
  /**
   * A row joined the transcript, the moment it did (the model's answer, a tool result, a nudge, a steer). A surface whose
   * conversation outlives the run keeps its own log from these: unlike the transcript, which compaction rewrites, the log is
   * append-only. Rows the compaction wrote are not announced.
   */
  appended?(row: RunMessage): void;
  /**
   * Whether an exception a port threw is a RESUMABLE interruption (a platform eviction the host re-arms the run after)
   * rather than the run's failure. Absent ⇒ never: the run fails terminal with its row, `run.finished` and code map. A
   * resumable one writes nothing terminal and the failed outcome carries it as `cause` for the host to re-throw.
   */
  isResumable?(err: unknown): boolean;
}

// The uniform outcome row (§8.2) lives with the telemetry that builds it.
export type { RunOutcomeRow } from "./telemetry/rowType.js";
import type { RunOutcomeRow } from "./telemetry/rowType.js";

/** Where the run's events go: the live trace, the timeline, the relay frames. */
export interface EventSink {
  emit(event: RunEvent, meta?: { durationMs?: number }): Promise<void> | void;
  /** The run's outcome row, written once at the end. */
  outcome?(row: RunOutcomeRow): Promise<void> | void;
}

/** What a human said, or that the run is waiting for one. */
export type HumanAnswer =
  | { kind: 'answered'; answer: string; approved?: boolean }  // approved: the STRUCTURED decision of an approval (never read from the answer text)
  | { kind: 'paused'; approvalId?: string };  // approvalId: the record the surface parked the run on, when it created one

/** How people are reached: the tool-confirm gate, the approval bar, the relay ask. */
export interface HumanChannel {
  /** Ask a question. `paused` parks the run until the answer arrives. */
  ask(question: string, options?: readonly string[]): Promise<HumanAnswer>;
  /** Approve a gate. Optional: a surface with no approvals omits it. */
  approve?(gate: PolicyGate, call?: { tool: string; args: Record<string, unknown>; reason?: string; approvalId?: string }): Promise<HumanAnswer>;
}

/** One steered message, as a port that knows more than its text hands it over. */
export interface SteerInput {
  text: string;
  /** The person's own words — it interrupts the step in flight (§6.3, E10). */
  interrupt?: boolean;
  /** Attachments the message carried, as data. */
  attachments?: unknown;
  /** The pictures the message carried, as the parts of the row it becomes. */
  parts?: RunPart[];
}

/** What the user steered in since the last step. */
export interface SteeringSource {
  /** The messages since the last drain. Empty when nothing was steered. */
  drain(): Array<string | SteerInput> | Promise<Array<string | SteerInput>>;
  /** True while an interrupting message waits. Absent ⇒ steers only land between steps. */
  hasInterrupt?(): boolean;
  /**
   * Messages the person queued to be taken only once the run would otherwise stop (additive). The run continues on them instead of
   * finishing, each as a user turn. Absent or empty ⇒ the run finishes.
   */
  followUp?(): Array<string | SteerInput> | Promise<Array<string | SteerInput>>;
  /** Be told the moment an interrupting message arrives; returns the unsubscribe. */
  onInterrupt?(listener: () => void): () => void;
}

/** The context pack, built once before turn 1 with NO model call (§6.10). */
export interface ContextSource {
  pack(task: RunTask): Promise<ContextPack> | ContextPack;
  /**
   * Sections the surface adds to EVERY turn's volatile tail, rebuilt per request and never
   * persisted (the cloud's evolving affect block). Absent ⇒ the tail carries the pack and
   * the brief only.
   */
  turnSections?(): readonly string[];
}

/**
 * Tools the surface runs itself, beside the registry's (the cloud's curated platform tools,
 * an addressed reply's chat-scoped set). The agent advertises `schemas`, and dispatches a call
 * whose name `handles` to `dispatch` — the surface owns what the tool does, the agent owns
 * when it may be called (the same gates, caps and coverage as every other tool).
 */
export interface ToolExtension {
  /** The tools to advertise. */
  schemas(): readonly ToolSchema[];
  /** Whether this extension runs `name`. */
  handles(name: string): boolean;
  /** Run the call. A thrown error is the tool's failure, never the run's. */
  dispatch(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ data: unknown; isError?: boolean; control?: { kind: 'finish'; summary: string } }>;
  /**
   * A turn whose calls end the run before any of them dispatches (an addressed reply's `ask_user`): the output to
   * settle with, or nothing to let the calls run. `content` is what the turn said.
   */
  terminalTurn?(turn: { content: string }, calls: ReadonlyArray<{ name: string; args: Record<string, unknown>; malformed: boolean }>): string | undefined;
  /** Shape the result of a tool the REGISTRY ran (the surface saves a snapshot the model reads a summary of). Absent ⇒ as-is. */
  shape?(name: string, data: unknown): Promise<unknown> | unknown;
}

export interface RunPorts {
  model: ModelTransport;           // complete(request, signal) → completion
  capabilities: CapabilityProvider;// @builderforce/agent-tools contract (files, shell, git, platform, memory, human)
  store: RunStore;                 // load/save RunState; commitMemory(consolidated)
  events: EventSink;               // typed RunEvent stream + the uniform outcome row (§8.2)
  human: HumanChannel;             // ask(question, options) | approve(gate) → answer | 'paused'
  steering?: SteeringSource;       // drain(): user messages since the last step
  context: ContextSource;          // pack(task) → ContextPack, built once before turn 1 with NO model call (§6.10)
  platform?: PlatformTools;        // the surface's own tools as a capability provider on this run (canvas board tools)
  delivery?: DeliveryLedger;       // what the task still owes when a turn ends in prose — the stall ladder's rungs
  extensions?: ToolExtension;      // tools the surface runs itself beside the registry's (the platform tools)
  tools?: readonly ToolDefinition[]; // registry tools only THIS entry point has (skill authoring, delegation)
  spend?: SpendMeter;              // the run's spend, when a surface shares one across runs (a sub-agent accrues into its owner's cap); absent ⇒ the run keeps its own
  attach?(run: RunView): void;     // called once, before turn 1: the live run a surface may read the model policy from
}

/** The run's spend, as the USD cap reads and feeds it (`RunPolicy.budgets.usd`). */
export interface SpendMeter {
  /** Millicents spent so far, across every run that shares the meter. */
  spentMc(): number;
  /** Calls that had no known price, so the spend is a floor. */
  unpricedCalls(): number;
  /** The tightest cap any run on the meter was started with, when one is tighter than this run's own. */
  capMc?(): number | undefined;
  /** One turn answered: its price, or undefined when it has none. */
  add(pricedMc: number | undefined): void;
}

/** The live run, handed to the surface once (`RunPorts.attach`): the one place it reads the model policy and advances it. */
export interface RunView {
  /** The model hand-off policy's state as it stands NOW. */
  policy(): RunPolicyState;
  /** Report an event to the model hand-off policy; the new state is the run's. */
  report(event: RunPolicyEvent): RunPolicyState;
}

// ── The context pack ──────────────────────────────────────────────────────────

/** Volatile per-run context. It goes in the turn-context block, never in the cached prefix. */
export interface ContextPack {
  focus: Array<{ path: string; outline?: Array<{ heading: string; line: number }>; content?: string }>; // named files: whole when under the read cap, else outline
  chat?: { tickets: unknown[]; runs: unknown[] };   // what gatherChatDiagnostics reads
  repos?: Array<{ repo: string; branch: string; dirty: string[] }>;
  facts: Array<{ key: string; content: string }>;   // codemap:<area> facts for the areas the focus files name
  recall: string[];                                  // Evermind recall, queried with prompt + focus-file terms
  /** A deterministic answer found before any model call (a PreFetch tool reply): the run settles on it, and no model is asked. */
  answer?: string;
}

// ── The outcome ───────────────────────────────────────────────────────────────

/** The `failed` reason of a run that was stopped (Stop, an abort, or a steered stop command). */
export const RUN_CANCELLED_REASON = "cancelled";

export type RunOutcomeKind = 'finished' | 'paused' | 'yielded' | 'failed';

export type RunOutcome =
  | { kind: 'finished'; output: string; state: RunState }
  | { kind: 'paused'; question: string; approvalId: string; state: RunState }
  | { kind: 'yielded'; state: RunState }          // maxSteps reached; resume later
  | { kind: 'failed'; reason: string; state: RunState; cause?: unknown; exhausted?: boolean };  // cause: a non-transport exception the surface may need to re-throw; exhausted: a budget or breaker ended it
