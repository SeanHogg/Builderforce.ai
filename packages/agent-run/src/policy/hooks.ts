/**
 * policy/hooks — THE contract between the agent and its policy modules.
 *
 * PRD 35 §3.2: the agent owns the policy; an adapter supplies PORTS and nothing else.
 * Each policy module (WS2a–g) owns one folder under `policy/` and exposes ONE hook,
 * and the composition in `runAgent.ts` calls that hook. Every hook is a NO-OP until
 * its workstream lands, so the agent runs today exactly as it did before, and each
 * WS2 module replaces its stub with the ported behaviour and its unchanged tests.
 *
 * The hooks are deliberately PORTS, not policy code: a hook receives the run's
 * context and returns a DECISION or a state change. Nothing here knows how to read
 * a file, call a model or write to a store — that is the surface's job, and the
 * agent's job is to ask.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import type { ToolSchema } from "@builderforce/agent-tools";
import type { HumanAnswer, RunEvent, RunMessage, RunPolicy, RunPorts, RunState, RunTask } from "../contract.js";

/** What every policy hook sees: the run, its policy, its state and its ports. */
export interface PolicyContext {
  /** The task the run was given. */
  task: RunTask;
  /** The policy the run was given. `entryPoint` is a telemetry label only. */
  policy: RunPolicy;
  /** The run's state, as it stands. A hook MAY mutate its slices. */
  state: RunState;
  /** The run's ports. A hook reads them; it never replaces them. */
  ports: RunPorts;
  /** The absolute step, across resumes. */
  step: number;
  /** The turn within this invocation. */
  turn: number;
  /** The transcript so far, in the agent's own row shape. */
  messages: readonly RunMessage[];
  /** The tool schemas the surface can run, before the tools policy narrows them. */
  tools: readonly ToolSchema[];
  /** The turn's assistant content, when the hook runs after the model answered. */
  content?: string;
  /** The turn's tool calls, when the hook runs around them. */
  toolCalls?: readonly PolicyToolCall[];
  /** The cancellation signal, when the caller supplied one. */
  signal?: AbortSignal;
}

/** One tool call, as the policy sees it. */
export interface PolicyToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// ── The hooks ────────────────────────────────────────────────────────────────

/** WS2a — compaction with reserve tokens. */
export interface CompactionHook {
  /**
   * Compact the transcript when it outgrows the budget. Returns the compacted
   * messages and what it dropped, or nothing to leave the transcript alone.
   */
  compact(ctx: PolicyContext): Promise<CompactionResult | void> | CompactionResult | void;
}

/** What a compaction did. */
export interface CompactionResult {
  /** The compacted transcript. */
  messages: RunMessage[];
  /** How many messages were dropped. */
  dropped: number;
  /** The tokens reserved for the answer. */
  reserveTokens?: number;
}

/** WS2b — stall recovery: narration, repetition, forced synthesis, prose ask-lift. */
export interface StallHook {
  /** Judge a turn that ended without a tool call. Returns what to do about it, or nothing to accept it. */
  recover(ctx: PolicyContext): Promise<StallDecision | void> | StallDecision | void;
  /** Shape the answer `recover` accepted (repetition trim, prose ask-lift). Absent ⇒ the text as-is. */
  settle?(ctx: PolicyContext, text: string): string;
  /** A turn called a tool — it was not a stall, so the re-prompt budget starts full again. */
  acted?(ctx: PolicyContext): void;
  /**
   * The prompt for ONE forced no-tools turn when the run ended without an answer (a
   * budget ran out, a breaker tripped, every turn only called tools). Absent or empty ⇒
   * no synthesis.
   */
  synthesis?(ctx: PolicyContext): string | null | void;
}

/** What to do about a stalled turn. */
export interface StallDecision {
  /** Steer the model back on track. */
  action: "steer" | "escalate" | "pause";
  /** The note the model reads on the next turn. */
  note?: string;
}

/** WS2c — steering between steps. */
export interface SteeringHook {
  /** Turn the messages the user steered in into transcript rows. */
  inject(ctx: PolicyContext, steered: readonly string[]): Promise<RunMessage[] | void> | RunMessage[] | void;
}

/** WS2c — asking a human. */
export interface AskHook {
  /** Ask a question and wait for the answer, or park the run. */
  answer(ctx: PolicyContext, question: string, options?: readonly string[]): Promise<HumanAnswer>;
}

/** WS2c — sub-agents. A child is the SAME agent, with its own ports. */
export interface SubagentsHook {
  /**
   * The end-of-run backstop: a run about to settle (or ask a human) without starting the
   * sub-agents it was asked for gets this note instead. Null when settling is right.
   */
  backstop(ctx: PolicyContext): string | null;
  /**
   * The EARLY nudge (WS8c): after a dispatched call, the replacement result that carries
   * "stop reading and delegate" on the read that reached `readsBeforeNudge`. Nothing ⇒
   * the result stands.
   */
  nudge(ctx: PolicyContext, call: PolicyToolCall, result: unknown): { data: unknown } | void;
}

/** WS2d — the finish gates: placeholder, no-deliverable, CI, review verdict, sign-off. */
export interface FinishHook {
  /**
   * Judge a finish. Returns a block reason to REFUSE it (the model sees the reason
   * and keeps going) or null to accept it.
   */
  gate(ctx: PolicyContext): Promise<string | null> | string | null;
  /**
   * Judge a PROSE answer (a turn that settled without the `finish` tool). Only the gates
   * that hold every settle apply — the sign-off a reviewer owes; a prose reply is not
   * held to a deliverable. Returns the block reason, or null to let it settle.
   */
  settleBlock(ctx: PolicyContext): string | null;
}

/** WS2d — the in-run guards: progress (A3), cascade (D1), post-edit check (D7), parallel reads (D8). */
export interface GuardsHook {
  /** Before a call dispatches. A hook may skip it. */
  beforeDispatch(ctx: PolicyContext, call: PolicyToolCall): Promise<GuardDecision | void> | GuardDecision | void;
  /**
   * After a call returned. Returns the replacement result when a guard has something the
   * model must read on it (D7's post-edit note), or nothing to let the result stand.
   */
  observe(ctx: PolicyContext, call: PolicyToolCall, result: unknown): Promise<{ data: unknown } | void> | { data: unknown } | void;
  /** The turn's calls all ran; `content` is what the turn said (A3's readiness claims, WS8p). */
  endTurn?(ctx: PolicyContext, content: string): Promise<void> | void;
  /** D8: whether a call only reads, so a run of them may dispatch together. Absent ⇒ sequential. */
  isReadOnly?(ctx: PolicyContext, name: string): boolean;
}

/** A control signal a skipped call carries — `ask_human` parks the run on a person. */
export interface GuardControl {
  kind: "ask_human";
  approvalId?: string;
  question: string;
  /** The answers the person is offered. */
  options?: readonly string[];
  /** The surface already parked the run on a person (an approver answered 'paused'): park it, never ask again. */
  parked?: true;
}

/** What a guard decided about a call. */
export interface GuardDecision {
  /** Skip the call and push this result instead; a `control` parks the run (A3's pause). */
  skip?: { data: unknown; isError?: boolean; control?: GuardControl };
}

/** WS2d — the run-end verify: the declared checks, or the branch's CI. */
export interface VerifyHook {
  /** Verify the run's work. Returns the verdict, or nothing when there is nothing to verify. */
  verify(ctx: PolicyContext): Promise<VerifyResult | void> | VerifyResult | void;
}

/** What a verify found. */
export interface VerifyResult {
  ok: boolean;
  note?: string;
}

/** WS2e — the run's memory: the per-turn brief and the run-end consolidation. */
export interface MemoryHook {
  /** The brief for this turn, or null when there is nothing worth saying. */
  brief(ctx: PolicyContext): Promise<string | null> | string | null;
  /** Record one dispatched call into the run's memory (the brief and the map are built from it). */
  observe?(ctx: PolicyContext, call: PolicyToolCall, result: unknown, isError?: boolean): Promise<void> | void;
  /** The consolidated memory the run produced, written back through `store.commitMemory`. */
  consolidate(ctx: PolicyContext, opts?: { learn?: boolean }): Promise<unknown> | unknown;
}

/** WS2e — the context pack's recall. */
export interface ContextHook {
  /**
   * The recall lines the run should carry, queried with the prompt and the focus terms.
   * Runs once, before turn 1; `ctx.ports.context.pack` answers the pack already built.
   */
  recall(ctx: PolicyContext): Promise<readonly string[] | void> | readonly string[] | void;
}

/** WS2f — the tool catalog: one strategy, a capability gate, pinning, scope and read coverage. */
export interface ToolsHook {
  /** Narrow the schemas the surface can run to the ones this run may call. */
  select(ctx: PolicyContext, tools: readonly ToolSchema[]): Promise<readonly ToolSchema[] | void> | readonly ToolSchema[] | void;
  /** Before a call dispatches: a read whose lines were already SERVED is answered without the disk. */
  beforeDispatch?(ctx: PolicyContext, call: PolicyToolCall): { data: unknown } | void;
  /** After a call returned: record what the model was served (or what a write invalidated). */
  observe?(ctx: PolicyContext, call: PolicyToolCall, result: unknown, isError: boolean): void;
  /**
   * The governance gates (`RunPolicy.approvalGates`) against one call: a `block` refuses it
   * (the model reads the refusal), a `require-approval` asks the human channel — answered in
   * run it proceeds, parked it returns the control that parks the run. Nothing ⇒ the call is allowed.
   */
  gate?(ctx: PolicyContext, call: PolicyToolCall): Promise<{ data: unknown; isError: true; control?: GuardControl } | void> | { data: unknown; isError: true; control?: GuardControl } | void;
}

/** WS2g — the model policy: the role ladder, the cascade, the learned routing, the pins. */
export interface ModelHook {
  /** The model this turn asks for, and the cap on its answer. */
  resolve(ctx: PolicyContext): Promise<ModelDecision | void> | ModelDecision | void;
  /** Before turn 1: the BYO preflight, as the `model.preflight` event the run emits. */
  preflight?(ctx: PolicyContext): Promise<Extract<RunEvent, { kind: "model.preflight" }>> | Extract<RunEvent, { kind: "model.preflight" }>;
  /**
   * After a turn: an `llm.model_downgrade` event when the turn was answered by another
   * model than the run expected (a pin failed over, or an auto-routed turn landed on a
   * degraded model). Nothing when the answer is the expected one.
   */
  downgrade?(ctx: PolicyContext, requested: string | undefined, served: string | undefined): Extract<RunEvent, { kind: "llm.model_downgrade" }> | void;
}

/** What the model policy decided. */
export interface ModelDecision {
  /** The model to ask for. */
  model?: string;
  /** The hard cap on this turn's answer, in tokens. */
  maxTokens?: number;
}

/** Every hook, in one object. The composition passes this whole object around. */
export interface PolicyHooks {
  compaction: CompactionHook;
  stall: StallHook;
  steering: SteeringHook;
  ask: AskHook;
  subagents: SubagentsHook;
  finish: FinishHook;
  guards: GuardsHook;
  verify: VerifyHook;
  memory: MemoryHook;
  context: ContextHook;
  tools: ToolsHook;
  model: ModelHook;
}
