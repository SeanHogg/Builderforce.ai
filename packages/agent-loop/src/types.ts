/**
 * Contract of THE agent loop.
 *
 * One iteration = ask the model → run every tool it called → ask again, until the
 * model stops calling tools, a tool signals `finish`, a tool asks a human, the run is
 * cancelled or the step budget is spent. The kernel owns exactly that skeleton — the
 * budget, the cancel check, argument parsing, pushing the assistant / tool messages
 * and interpreting the two control signals. Everything a surface does differently
 * (steering, compaction, policy gates, stall recovery, tool selection, telemetry,
 * confirm prompts, read de-duplication) arrives through the ports and hooks below,
 * so the SAME kernel drives the Worker, the browser, Node and the extension host.
 *
 * `M` is the surface's own message type (OpenAI chat rows in most places, pi-style
 * `AgentMessage` in agent-runtime). The kernel never inspects a message — it only
 * asks the codec to build them and pushes them onto the transcript it was handed.
 */

/** A tool call as the model emitted it: arguments are the RAW JSON string. */
export interface LoopToolCall {
  id: string;
  name: string;
  arguments: string;
}

/** One successful model turn. `meta` is whatever the surface wants to carry through to its codec (usage, provider, raw message). */
export interface LoopTurn {
  content: string;
  toolCalls: LoopToolCall[];
  meta?: unknown;
}

/**
 * What the model port hands back per step:
 *  - a `LoopTurn` → normal iteration;
 *  - `{ failed }` → clean stop; the run ends `ok:false` with that text (a recorded gateway error the surface has already logged);
 *  - `{ skip: true }` → this step produced nothing usable (a stalled stream the surface already retried the model for); spend the step and loop again.
 */
export type LoopTurnResult = LoopTurn | { failed: string } | { skip: true };

/**
 * The control signals a tool may return alongside its data. Structurally identical to
 * `ToolControl` in `@builderforce/agent-tools`, restated here so this package keeps zero
 * inter-package edges (a surface that only consumes this kernel need not resolve the
 * tool contract).
 */
export type LoopControl =
  | { kind: "finish"; summary: string }
  | { kind: "ask_human"; approvalId?: string; question: string };

/** What tool dispatch hands back: the payload the model will see, an optional control signal, and whether the surface wants it flagged as an error message. */
export interface LoopDispatchResult {
  data: unknown;
  control?: LoopControl;
  isError?: boolean;
}

/** A tool call after the kernel parsed its arguments. `malformed` ⇒ the JSON was invalid and `args` is `{}`. */
export interface ParsedToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  raw: LoopToolCall;
  malformed: boolean;
}

/** Builds the two message shapes the kernel pushes onto the transcript. */
export interface LoopCodec<M> {
  /** The assistant row for a turn that called tools (the kernel never pushes a tool-free final turn — `onNoToolCalls` decides that). */
  assistant(turn: LoopTurn): M;
  /** The tool-result row for one call. The codec owns serialisation and budgeting of the payload. */
  tool(call: ParsedToolCall, result: LoopDispatchResult): M;
}

/** Read/write view of the run that every port and hook receives. */
export interface TurnContext<M> {
  /** The live transcript. The kernel pushes onto THIS array; surfaces persist it by reference. */
  readonly messages: M[];
  /** Absolute step index across the whole run (survives resume). */
  readonly step: number;
  /** Step index within this invocation (0 on the first iteration after resume). */
  readonly stepInCall: number;
  readonly signal: AbortSignal | undefined;
  /** Best output so far: the latest non-empty assistant content, or a finish summary. */
  readonly output: string;
  /** Consecutive tool dispatches flagged `isError`, across turns. A successful dispatch resets it. */
  readonly failureStreak: number;
}

export interface LoopPorts<M> {
  /** Ask the model. Retries, cascades and streaming are the port's business; throw to abort the run, or return `{failed}` for a clean recorded stop. */
  complete(ctx: TurnContext<M>): Promise<LoopTurnResult>;
  /** Run one tool. Throw to abort the run; return `isError` + data to keep going with an error payload. */
  dispatch(call: ParsedToolCall, ctx: TurnContext<M>): Promise<LoopDispatchResult>;
}

export type StopDecision = { action: "stop"; ok?: boolean; output?: string; finished?: boolean };

export type NoToolCallsDecision =
  | { action: "finish"; output?: string }
  | { action: "continue" }
  | StopDecision;

export type DispatchDecision =
  /** Skip the tool: push this result as if it had run (de-duplicated reads, declined confirms, unknown tools). */
  | { result: LoopDispatchResult }
  /** Run a different call instead (router tools rewriting themselves into the real target). */
  | { rewrite: ParsedToolCall }
  | undefined
  | void;

export interface AfterDispatchDecision {
  /** Abandon the remaining calls of this turn; each gets `skipped` pushed as its result (steering arrived mid-turn). */
  skipRemaining?: { data: unknown; isError?: boolean };
}

/** What `afterToolCalls` may change about the turn it just watched. Named, like every
 *  other hook decision here, because an inline object literal in the hook signature
 *  left the loop's `const after = await hooks.afterToolCalls?.(…)` with nothing to
 *  infer from and the compiler resolved it circularly (TS7022). */
export interface AfterToolCallsDecision {
  /** Override whether the run is finished — queued steering re-opens a finished run. */
  finished?: boolean;
}

export interface LoopHooks<M> {
  /** Polled before every step, in addition to `signal`. */
  isCancelled?(ctx: TurnContext<M>): Promise<boolean> | boolean;
  /** Runs before the model is asked (containment limits, compaction, budget checks). `stop` ends the run without a model call. */
  beforeTurn?(ctx: TurnContext<M>): Promise<StopDecision | void> | StopDecision | void;
  /** Runs after the model answered, before anything is pushed (telemetry, trace, output capture). */
  afterTurn?(ctx: TurnContext<M>, turn: LoopTurn): Promise<void> | void;
  /** A turn with NO tool calls. Default: finish with the turn's content. */
  onNoToolCalls?(ctx: TurnContext<M>, turn: LoopTurn): Promise<NoToolCallsDecision> | NoToolCallsDecision;
  /** A turn WITH tool calls, before the assistant row is pushed. `stop` ends the run and the row is NOT pushed (terminal tools such as `ask_user`). */
  beforeToolCalls?(ctx: TurnContext<M>, turn: LoopTurn, calls: ParsedToolCall[]): Promise<StopDecision | void> | StopDecision | void;
  /** Per call, before dispatch. May short-circuit with a result or rewrite the call. */
  beforeDispatch?(call: ParsedToolCall, ctx: TurnContext<M>): Promise<DispatchDecision> | DispatchDecision;
  /** A tool returned `finish`. Return a block reason to REFUSE the finish (the model sees `{ok:false,error}` and keeps going), or null to accept. */
  onFinish?(ctx: TurnContext<M>, summary: string, call: ParsedToolCall): Promise<string | null> | string | null;
  /** A tool returned `ask_human`. The run ends after this turn's remaining calls with `awaitingInput` set. */
  onAskHuman?(ctx: TurnContext<M>, control: Extract<LoopControl, { kind: "ask_human" }>, call: ParsedToolCall): Promise<void> | void;
  /** Per call, after its result row was pushed (`message` is that row). */
  afterDispatch?(call: ParsedToolCall, result: LoopDispatchResult, message: M, ctx: TurnContext<M>): Promise<AfterDispatchDecision | void> | AfterDispatchDecision | void;
  /** After every call of the turn ran. May override `finished` (queued steering re-opens a finished run). */
  afterToolCalls?(ctx: TurnContext<M>, finished: boolean): Promise<AfterToolCallsDecision | void> | AfterToolCallsDecision | void;
}

/**
 * Consecutive failed tool dispatches after which a run is stopped, when the surface
 * names no other number. ONE value, owned here, so every surface stops for the same
 * reason at the same point.
 *
 * ── WHY A FAILURE STREAK, AND NOT A STEP COUNT ──────────────────────────────────
 * A run is not wrong for being long. A bulk ticket clean-up, a rename across a
 * repository, a review of forty branches — each is a hundred honest tool calls, and a
 * step ceiling stopped every one of them mid-task with "kept calling tools without
 * finishing". The ceiling existed to catch a run that had stopped making progress, and
 * that condition has a direct signal: tool calls that keep FAILING. So the only limit
 * the kernel applies is this one — a run whose last N dispatches all failed is stuck,
 * and stopping it is what the step cap was always trying to do by proxy. Five is past
 * the point where the repeat-failure advisories (nudge at 2, instruct at 3) have had
 * their say and been ignored.
 */
export const DEFAULT_TOOL_FAILURE_STREAK = 5;

export interface LoopBudget {
  /** Absolute step to resume from (0 for a fresh run). */
  startStep?: number;
  /** Steps this invocation may take before yielding (tick-driven runners pass 1). Unbounded when omitted. */
  maxSteps?: number;
  /**
   * Absolute cap across the whole run. UNBOUNDED when omitted — the default, and the
   * right one for every conversational and coding surface: a run stops when it
   * finishes, when a human stops it, or when its tools keep failing
   * ({@link failureStreakCap}), never because it worked for too long. A surface that
   * is bounded BY DESIGN (a delegated sub-agent brief) states its number here.
   */
  stepCap?: number;
  /**
   * Consecutive `isError` dispatches that end the run. Defaults to
   * {@link DEFAULT_TOOL_FAILURE_STREAK}; pass `Number.POSITIVE_INFINITY` to disable.
   */
  failureStreakCap?: number;
}

export interface LoopRunArgs<M> {
  messages: M[];
  codec: LoopCodec<M>;
  ports: LoopPorts<M>;
  hooks?: LoopHooks<M>;
  budget: LoopBudget;
  signal?: AbortSignal;
  /** Output to start from when resuming (the run's last recorded output). */
  initialOutput?: string;
}

export interface LoopResult {
  ok: boolean;
  output: string;
  /** The run reached a terminal state (finish / final answer / stop). False when it yielded on budget or cancel. */
  finished: boolean;
  cancelled: boolean;
  /** Absolute step index after this invocation — feed it back as `startStep` to resume. */
  step: number;
  /** The run was stopped by a budget without finishing — see `exhaustedBy` for which. */
  exhausted: boolean;
  /** `steps`: the absolute step cap. `failures`: the tool-failure streak. Absent unless `exhausted`. */
  exhaustedBy?: "steps" | "failures";
  /** Consecutive failed dispatches at the end of this invocation (what tripped a `failures` stop). */
  failureStreak: number;
  /** A tool asked a human; the caller pauses and resumes once answered. */
  awaitingInput?: { approvalId?: string; question: string; callId: string };
}
