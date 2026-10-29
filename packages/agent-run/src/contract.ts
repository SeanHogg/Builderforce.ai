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
  PolicyGate,
  RunKnowledgeState,
  ToolSchema,
} from "@builderforce/agent-tools";
import type { CostLeverId } from "@builderforce/cost-levers";
import type { CascadeState, RunPolicyOptions, RunPolicyState } from "@builderforce/run-policy";
import type {
  CoveredRead,
  ProgressDetectorState,
  ReadsWithoutSpawnState,
} from "@builderforce/run-guards";
import type { EntryPoint } from "@builderforce/learned-routing";
import type { FinishGateState } from "./policy/finish/gates.js";
import type { RunTally } from "./telemetry/runTally.js";
import type { DeliveryLedger, PlatformTools, TurnInterruption } from "./surface.js";

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
  prompt: string;
  runId?: string;                  // the adapter's id for this run (execution / client run id) — the §8.2 row's run id
  ticketId?: number; chatId?: number | string; projectId?: number;
  persona?: string;                // compiled persona brief
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
    /** Tokens held back for the reply when compaction sizes the transcript. Absent ⇒ the host-neutral floor (`compactionReserve`). A surface whose replies are bounded far below it says so here (≤ about a quarter of its smallest window). */
    reserveTokens?: number;
  };
  pinnedModel?: string;
  inference: 'local-only' | 'hybrid' | 'specific';
  verify: 'declared-checks' | 'branch-ci' | 'none';
  signoff?: { roleKey: string; laneKey?: string };   // finish blocked until signed off
  approvalGates: PolicyGate[];                        // in-run acts needing an approver — reuse @builderforce/agent-tools spec.ts:118
  delegation: { requested: boolean; readsBeforeNudge: number };  // requested = asksForSubagents(prompt) unless declined; default nudge after 6 reads
  /** How the model policy hands a run between models, where the surface's session has a say (routed-around models, strict failover). Absent ⇒ the policy's defaults. */
  modelOptions?: Pick<RunPolicyOptions, 'strictPin' | 'pinReleasable' | 'lockAfterFirstSuccess' | 'preferProvenFailover' | 'strictFailover' | 'excludeModels'>;
}

// ── The ports ─────────────────────────────────────────────────────────────────

/** One row of the run's transcript, in the agent's own shape. */
export interface RunMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** The tool calls the assistant asked for, in the kernel's raw form. */
  toolCalls?: { id: string; name: string; arguments: string }[];
  /** The call this row answers. */
  toolCallId?: string;
  /** This row carries the TASK the run was given: compaction pins it, whatever else the transcript holds before it (a prior conversation). Absent ⇒ the first user row. */
  task?: true;
}

/** What the agent asks the model for. The transport translates it to its own wire shape. */
export interface ModelRequest {
  /** The transcript so far. */
  messages: RunMessage[];
  /** The model the policy pinned, when it pinned one. */
  model?: string;
  /** The tools the surface can run, as the model sees them. */
  tools?: ToolSchema[];
  /** The hard cap for this turn's answer. */
  maxTokens?: number;
  /** The role the turn asks for (`plan` | `code` | `chat` …), as the model policy chose it. */
  role?: string;
  /** Whether `model` is a strict pin the gateway must not route off. */
  strict?: boolean;
  /** Models the policy routes around. */
  excludeModels?: readonly string[];
}

/** A tool call as the model asked for it: the arguments are the RAW JSON string. */
export interface ModelToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** What the model spent on the turn. */
export interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  costMc?: number;                 // millicents the gateway billed, when the transport reports it — §8.2 cost
}

/** What the model answered. */
export interface ModelCompletion {
  content: string;
  toolCalls?: ModelToolCall[];
  usage?: ModelUsage;
  model?: string;
  /** Set when the turn was cut off (the output ceiling, an unparseable call) rather than finished. The transport reads its own vendor's finish reason. */
  interrupted?: TurnInterruption;
}

/** Where the model runs. The ONE thing an entry point supplies about the model. */
export interface ModelTransport {
  complete(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion>;
  /**
   * The model's context window, when the transport knows it. The tools policy sizes
   * its result cap from it (§6.10); `undefined` ⇒ the fixed caps of today.
   */
  window?(model: string): number | undefined;
  /**
   * The compaction summarizer's call. A surface whose `complete` is visible to a person
   * (a streamed answer, a provenance row, a failure ledger) answers this one WITHOUT those
   * side effects: a summary is not a turn. Absent ⇒ the policy uses `complete`.
   */
  summarize?(request: ModelRequest, signal?: AbortSignal): Promise<ModelCompletion>;
  /**
   * The BYO preflight (§6.10): before turn 1, which connected accounts the run's model
   * would need cannot be used. The transport refreshes an `expired` token once itself and
   * reports only what is STILL unresolved. Absent ⇒ the preflight reads `ok`.
   */
  preflight?(model: string | undefined): Promise<ModelPreflightResult | undefined> | ModelPreflightResult | undefined;
}

/** What a transport's preflight found. Empty `byoUnresolved` ⇒ every connected account resolves. */
export interface ModelPreflightResult {
  /** `provider:reason` entries, exactly as the gateway's `x-builderforce-byo-unresolved` header spells them. */
  byoUnresolved: readonly string[];
  /** Providers whose `expired` token the transport refreshed successfully. */
  refreshed?: readonly string[];
  /** The model the run falls back to, when the transport knows it. */
  fallback?: string;
}

/** Where the run's state lives. */
export interface RunStore {
  /** The state to resume from, or nothing for a fresh run. */
  load(): Promise<RunState | undefined> | RunState | undefined;
  /** Persist the state at a step boundary, so a later tick resumes from it. */
  save(state: RunState): Promise<void> | void;
  /** The run-end write-back: the consolidated memory the run produced. */
  commitMemory?(consolidated: unknown): Promise<void> | void;
}

/** One event of the run's trace. The trace is what every adapter must match. */
export type RunEvent =
  | { kind: 'run.started'; step: number }
  | { kind: 'turn.started'; step: number }
  | { kind: 'model.completed'; step: number; model?: string; usage?: ModelUsage }
  | { kind: 'tool.dispatched'; step: number; tool: string; ok: boolean }
  | { kind: 'steer.applied'; step: number }          // one per steered message, before the turn it reaches (§6.3)
  | { kind: 'model.preflight'; step: number; status: 'ok' | 'refreshed' | 'degraded'; notices: string[] }  // once, before turn 1 (§6.10)
  | { kind: 'llm.model_downgrade'; step: number; requestedModel: string; model: string; reason: string }  // a turn answered by another model than expected (E7)
  | { kind: 'turn.finished'; step: number }
  | { kind: 'run.finished'; step: number; outcome: RunOutcomeKind };

// The uniform outcome row (§8.2) lives with the telemetry that builds it.
export type { RunOutcomeRow } from "./telemetry/rowType.js";
import type { RunOutcomeRow } from "./telemetry/rowType.js";

/** Where the run's events go: the live trace, the timeline, the relay frames. */
export interface EventSink {
  emit(event: RunEvent): Promise<void> | void;
  /** The run's outcome row, written once at the end. */
  outcome?(row: RunOutcomeRow): Promise<void> | void;
}

/** What a human said, or that the run is waiting for one. */
export type HumanAnswer =
  | { kind: 'answered'; answer: string }
  | { kind: 'paused' };

/** How people are reached: the tool-confirm gate, the approval bar, the relay ask. */
export interface HumanChannel {
  /** Ask a question. `paused` parks the run until the answer arrives. */
  ask(question: string, options?: readonly string[]): Promise<HumanAnswer>;
  /** Approve a gate. Optional: a surface with no approvals omits it. */
  approve?(gate: PolicyGate): Promise<HumanAnswer>;
}

/** One steered message, as a port that knows more than its text hands it over. */
export interface SteerInput {
  text: string;
  /** The person's own words — it interrupts the step in flight (§6.3, E10). */
  interrupt?: boolean;
  /** Attachments the message carried, as data. */
  attachments?: unknown;
}

/** What the user steered in since the last step. */
export interface SteeringSource {
  /** The messages since the last drain. Empty when nothing was steered. */
  drain(): Array<string | SteerInput>;
  /** True while an interrupting message waits. Absent ⇒ steers only land between steps. */
  hasInterrupt?(): boolean;
  /** Be told the moment an interrupting message arrives; returns the unsubscribe. */
  onInterrupt?(listener: () => void): () => void;
}

/** The context pack, built once before turn 1 with NO model call (§6.10). */
export interface ContextSource {
  pack(task: RunTask): Promise<ContextPack> | ContextPack;
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
}

// ── The context pack ──────────────────────────────────────────────────────────

/** Volatile per-run context. It goes in the turn-context block, never in the cached prefix. */
export interface ContextPack {
  focus: Array<{ path: string; outline?: Array<{ heading: string; line: number }>; content?: string }>; // named files: whole when under the read cap, else outline
  chat?: { tickets: unknown[]; runs: unknown[] };   // what gatherChatDiagnostics reads
  repos?: Array<{ repo: string; branch: string; dirty: string[] }>;
  facts: Array<{ key: string; content: string }>;   // codemap:<area> facts for the areas the focus files name
  recall: string[];                                  // Evermind recall, queried with prompt + focus-file terms
}

// ── The outcome ───────────────────────────────────────────────────────────────

export type RunOutcomeKind = 'finished' | 'paused' | 'yielded' | 'failed';

export type RunOutcome =
  | { kind: 'finished'; output: string; state: RunState }
  | { kind: 'paused'; question: string; approvalId: string; state: RunState }
  | { kind: 'yielded'; state: RunState }          // maxSteps reached; resume later
  | { kind: 'failed'; reason: string; state: RunState };

// ── The state ─────────────────────────────────────────────────────────────────

/**
 * A3's progress detector, D1's cascade and D7's checks note — the guard state a run
 * carries across a step boundary.
 *
 * Mirrors `api/src/application/runtime/costLoop/loopGuards.ts` field for field: WS2d
 * ports that module into `policy/guards` and deletes the API copy, so this becomes the
 * only definition rather than a copy of one.
 */
export interface LoopGuardState {
  /** A3: the progress detector's tallies and trip count. */
  progress?: ProgressDetectorState;
  /** D1: the cascade's units, the first tick's action type, the seed's softness. */
  cascade?: CascadeSessionState;
  /** A3: a pause the next dispatched call parks the run on. */
  pendingPause?: string;
  /** D7: the sandbox checks' failures, for the NEXT turn's tail. */
  checksNote?: string;
  escalations?: number;            // A3 + D1: moves up the tier ladder this run — §8.2 escalations
}

/** What the cascade persists across durable ticks — `api/.../costLoop/verifierCascade.ts`. */
export interface CascadeSessionState {
  /** The cascade's own state (`@builderforce/run-policy`). */
  cascade?: CascadeState;
  /** The task's action type, resolved on the first tick (later ticks only have `other`). */
  actionType?: string;
  /** Whether this run's seed is soft (the cascade may move it). */
  soft?: boolean;
  /** The steer the next turn shows, until that turn ends. */
  steer?: string;
  /** The tenant's prior weak pass rate, read once on the first tick. */
  priorWeakPassRate?: number;
  /** Whether that read happened (a cold tenant has no rate, and must not re-ask). */
  priorRead?: boolean;
}

/**
 * What compaction carried out. WS1 names the type (there is no home for it today);
 * WS2a owns its behaviour in `policy/compaction`.
 */
export interface CompactionState {
  /** How many times the transcript has been compacted this run. */
  compactions: number;
  /** The step the last compaction happened at. */
  lastCompactedStep?: number;
  /** The tokens reserved for the answer when compacting. */
  reserveTokens?: number;
  /** How many messages the last compaction dropped. */
  droppedMessages?: number;
}

/**
 * The windows the model was SERVED, plus the read-without-spawn count.
 *
 * The served windows reuse `@builderforce/run-guards`' `CoveredRead` — the read guard
 * already owns what "the model has seen these lines" means — and the delegation
 * counter reuses its `ReadsWithoutSpawnState`. WS2f owns the behaviour in `policy/tools`.
 */
export interface ReadCoverageState {
  /** The windows served this run, by the read's canonical key. */
  served: Record<string, CoveredRead>;
  /** Read calls made while no spawn had been attempted — the delegation nudge's counter. */
  readsWithoutSpawn: ReadsWithoutSpawnState;
  stubCount?: number;  // reads answered from coverage (a stub or a replay), never dispatched — §8.2 coveredReadStubs
}

/**
 * The stall policy's re-prompt budget — the count the cloud loop kept on its durable
 * model state (`CloudRunModelState.stallRecoveries`), keyed by the model it was spent
 * against so a model change starts the new one with a full budget. WS2b owns it.
 */
export interface StallState {
  /** The model the re-prompts below were spent against. */
  model?: string;
  /** Re-prompts already spent against `model`. */
  recoveriesUsed: number;
  recoveriesTotal?: number;  // every re-prompt this run spent, never reset — §8.2 stallRecoveries
  rungs?: Record<string, number>;  // the delivery ladder's re-statements spent per rung (`DeliveryLedger`); reset when the turn moves to another model
  said?: string[];                 // rung ids whose one-time note was already said
}

/** Plain JSON. Everything any policy needs across a step boundary. */
export interface RunState {
  messages: unknown[]; step: number;
  guards: LoopGuardState;          // progress, cascade, pendingPause, checksNote — WS1 names this type; today's guard state lives in costLoop/loopGuards.ts
  finish: FinishGateState;         // placeholder / CI-pending / no-deliverable counters, signoff recorded — reuse cloudAgent/finishGates.ts:55, do not redefine
  model: RunPolicyState;           // @builderforce/run-policy — pins, tried/broken/proven models, failovers, turnRetries
  memory: RunKnowledgeState;       // working memory + tool tally — reuse @builderforce/agent-tools run-knowledge.ts:96, do not redefine
  compaction: CompactionState;
  writtenPaths: string[];
  askedGates: string[];
  reads: ReadCoverageState;        // the windows the model was SERVED (post-trim), plus the read-without-spawn count
  context?: ContextPack;           // the pack built once before turn 1 (§6.10); a resumed tick renders the same turn-context tail from it
  stall?: StallState;              // WS2b: the re-prompt budget, keyed by model
  preflight?: string;              // WS2g: the model preflight's verdict — ok | refreshed | degraded:<reason> (§8.2 modelPreflight)
  downgrades?: string[];           // WS2g: auto-routed models already reported by llm.model_downgrade (once per served model)
  telemetry?: RunTally;            // WS6: the per-run counters the §8.2 row reads, summed across ticks
}
