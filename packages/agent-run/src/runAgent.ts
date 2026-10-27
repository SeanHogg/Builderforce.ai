/**
 * runAgent — THE one agent (PRD 35 §3.2).
 *
 * One function drives every entry point. It builds the context pack once, asks the
 * kernel for a turn, dispatches the tools the model called through the surface's
 * capability provider, and stops when the model finishes, a gate blocks it, a human
 * is asked, the step budget yields, or the run fails. Everything a surface does
 * differently arrives through the PORTS it supplies and the POLICY hooks composed
 * from `policy/*` — this file never branches on `RunPolicy.entryPoint`.
 *
 * ── WHAT THIS FILE OWNS, AND WHAT IT DOES NOT ─────────────────────────────────
 * It owns the composition: the order the hooks run in, the transcript, the state
 * that crosses a step boundary, and the outcome. It does NOT own any behaviour a
 * workstream owns. Compaction, stall recovery, steering, asking a human, sub-agents,
 * the finish gates, the guards, verification, memory, the context pack's recall,
 * the tool catalog and the model policy are each a hook in `policy/`, and each is a
 * NO-OP until its workstream lands. So the agent runs today exactly as it did
 * before the split, and a workstream changes the agent's behaviour by replacing its
 * own folder — never by editing this file.
 *
 * ── THE KERNEL ────────────────────────────────────────────────────────────────
 * `runAgentLoop` (`@builderforce/agent-loop`) is the one loop. This file is its only
 * importer outside the package that defines it — that is the whole point of PRD 35,
 * and `check:one-execution` enforces it. The kernel owns the skeleton (the budget,
 * the cancel check, argument parsing, the assistant and tool rows); this file owns
 * what a turn means.
 *
 * ── RESUME ────────────────────────────────────────────────────────────────────
 * A run's state is plain JSON. A cloud tick runs one step (`maxSteps: 1`), saves the
 * state and yields; the next tick resumes from it. The same task run continuously
 * and run one step at a time produce the same trace — that is the conformance
 * suite's job to prove, and this file's job to make true.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { buildCoreToolRegistry, type ToolSchema } from "@builderforce/agent-tools";
import { initialRunPolicy, type RunPolicyState } from "@builderforce/run-policy";
import {
  openAiChatCodec,
  readOpenAiToolCalls,
  runAgentLoop,
  toOpenAiToolCall,
  type LoopDispatchResult,
  type LoopHooks,
  type LoopResult,
  type LoopTurn,
  type ParsedToolCall,
  type TurnContext,
} from "@builderforce/agent-loop";

import type {
  ContextPack,
  EventSink,
  ModelCompletion,
  ModelRequest,
  ModelUsage,
  ReadCoverageState,
  RunEvent,
  RunMessage,
  RunOutcome,
  RunOutcomeRow,
  RunPolicy,
  RunPorts,
  RunState,
  RunTask,
} from "./contract.js";
import { composePolicyHooks, type PolicyContext, type PolicyHooks, type PolicyModules, type PolicyToolCall } from "./policy/index.js";

/** What a caller hands the agent. */
export interface RunAgentInput {
  task: RunTask;
  policy: RunPolicy;
  ports: RunPorts;
  /** The state a prior invocation saved, to resume from. */
  resume?: RunState;
  /** Steps this invocation may take before yielding. `1` on a cloud tick; unbounded when omitted. */
  maxSteps?: number;
  /** The cancellation signal. A fired signal settles the run `failed` with reason `cancelled`. */
  signal?: AbortSignal;
  /**
   * Replace a policy module WHOLE. A test drives one module this way; a surface never
   * does — an adapter supplies ports, not policy.
   */
  modules?: Partial<PolicyModules>;
}

/** The registry the agent dispatches through. Built once: the catalog does not change per run. */
const REGISTRY = buildCoreToolRegistry();

/** The schemas the model is offered, before the tools policy narrows them. */
function offeredSchemas(ports: RunPorts): ToolSchema[] {
  return REGISTRY.schemasFor(ports.capabilities);
}

/** A fresh run's state. Every slice starts empty; a hook fills its own. */
function freshState(policy: RunPolicy): RunState {
  return {
    messages: [],
    step: 0,
    guards: {},
    finish: {
      noDeliverableBlocked: false,
      reviewVerdictRecorded: false,
      placeholderBlocks: 0,
      ciPendingBlocks: 0,
      ciFailureBlocks: 0,
      ciVerified: false,
      finishBlockedOnce: false,
    },
    model: initialModelState(policy),
    memory: { memory: { created: [], edited: [], deleted: [], read: [], searched: [] }, tools: [] },
    compaction: { compactions: 0 },
    writtenPaths: [],
    askedGates: [],
    reads: freshReads(),
  };
}

/**
 * The model policy's starting state. WS2g owns how a pin, a role and the inference
 * mode become a model; until it lands, a pinned model is asked for as-is and an
 * unpinned run lets the transport choose.
 */
function initialModelState(policy: RunPolicy): RunPolicyState {
  return initialRunPolicy({ pinnedModel: policy.pinnedModel });
}

function freshReads(): ReadCoverageState {
  return { served: {}, readsWithoutSpawn: { reads: 0, spawned: false, nudged: false } };
}

/** The state a resume hands back, with every slice present even if an older writer omitted one. */
function resumeState(saved: RunState, policy: RunPolicy): RunState {
  const fresh = freshState(policy);
  return {
    ...fresh,
    ...saved,
    guards: saved.guards ?? fresh.guards,
    finish: saved.finish ?? fresh.finish,
    model: saved.model ?? fresh.model,
    memory: saved.memory ?? fresh.memory,
    compaction: saved.compaction ?? fresh.compaction,
    writtenPaths: saved.writtenPaths ?? [],
    askedGates: saved.askedGates ?? [],
    reads: saved.reads ?? fresh.reads,
    messages: Array.isArray(saved.messages) ? saved.messages : [],
  };
}

/** A transcript row, read back out of the state it was saved as. */
function asMessages(raw: readonly unknown[]): RunMessage[] {
  const out: RunMessage[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<RunMessage>;
    if (r.role !== "system" && r.role !== "user" && r.role !== "assistant" && r.role !== "tool") continue;
    out.push({
      role: r.role,
      content: typeof r.content === "string" ? r.content : "",
      ...(Array.isArray(r.toolCalls) ? { toolCalls: r.toolCalls } : {}),
      ...(typeof r.toolCallId === "string" ? { toolCallId: r.toolCallId } : {}),
    });
  }
  return out;
}

/** The system prompt: the persona, then the task. The context pack is NOT here — it is volatile. */
function systemPrompt(task: RunTask): string {
  const parts: string[] = [];
  if (task.persona && task.persona.trim()) parts.push(task.persona.trim());
  parts.push(task.prompt);
  return parts.join("\n\n");
}

/**
 * The volatile turn-context block. It is rebuilt every turn from the pack and the
 * memory brief, and it is NEVER part of the cached prefix — that is why it is its
 * own message rather than folded into the system prompt.
 */
function turnContextBlock(pack: ContextPack, brief: string | null): string | null {
  const lines: string[] = [];
  for (const file of pack.focus) {
    if (file.content !== undefined) {
      lines.push(`## ${file.path}`, file.content);
    } else if (file.outline && file.outline.length > 0) {
      lines.push(`## ${file.path} (outline)`);
      for (const entry of file.outline) lines.push(`- ${entry.heading} (line ${entry.line})`);
    }
  }
  if (pack.chat) {
    lines.push(`## chat`, `${pack.chat.tickets.length} linked tickets, ${pack.chat.runs.length} runs`);
  }
  for (const repo of pack.repos ?? []) {
    lines.push(`## repo ${repo.repo}`, `branch ${repo.branch}`, repo.dirty.length > 0 ? `dirty: ${repo.dirty.join(", ")}` : "clean");
  }
  for (const fact of pack.facts) lines.push(`## ${fact.key}`, fact.content);
  for (const line of pack.recall) lines.push(line);
  if (brief && brief.trim()) lines.push("## brief", brief.trim());
  if (lines.length === 0) return null;
  return lines.join("\n");
}

/** What one turn of the run sees. Rebuilt per turn, because the hooks may have changed it. */
interface TurnView {
  messages: RunMessage[];
  tools: ToolSchema[];
  model?: string;
  maxTokens?: number;
}

/** The context every hook sees, for one moment of the run. */
function policyContext(input: RunAgentInput, state: RunState, view: TurnView, step: number, turn: number): PolicyContext {
  return {
    task: input.task,
    policy: input.policy,
    state,
    ports: input.ports,
    step,
    turn,
    messages: view.messages,
    tools: view.tools,
    signal: input.signal,
  };
}

/** Apply a hook's compaction, recording what it dropped. */
function applyCompaction(state: RunState, view: TurnView, result: { messages: RunMessage[]; dropped: number; reserveTokens?: number }, step: number): void {
  view.messages = result.messages;
  state.messages = result.messages;
  state.compaction = {
    compactions: state.compaction.compactions + 1,
    lastCompactedStep: step,
    ...(result.reserveTokens !== undefined ? { reserveTokens: result.reserveTokens } : {}),
    droppedMessages: result.dropped,
  };
}

/** The tally a turn adds to the outcome row. */
interface TurnTally {
  toolCalls: number;
  toolErrors: number;
  model?: string;
  usage?: ModelUsage;
}

/**
 * Drive one run to an outcome.
 *
 * The kernel owns the loop; this function owns the meaning of a turn. It asks the
 * model through the transport, dispatches each tool call through the registry (so
 * the capability gate is enforced at call time, not just at advertisement), and
 * asks each policy hook at the point the PRD names.
 */
export async function runAgent(input: RunAgentInput): Promise<RunOutcome> {
  const { task, policy, ports, signal } = input;
  const hooks = composePolicyHooks(input.modules);
  const state = input.resume ? resumeState(input.resume, policy) : freshState(policy);
  const resumed = Boolean(input.resume);

  const tally: TurnTally = { toolCalls: 0, toolErrors: 0 };
  const offered = offeredSchemas(ports);
  const transcript = asMessages(state.messages);

  // The volatile turn-context block is rebuilt every turn, but a tick that yielded
  // mid-run never rebuilt it — on resume the saved transcript still carries the last
  // one, and dropping it would change the prefix the continuous run never touched.
  let pack: ContextPack = { focus: [], facts: [], recall: [] };
  if (!resumed) {
    try {
      pack = await ports.context.pack(task);
    } catch {
      // A pack that cannot be built is an empty pack, not a failed run: the task
      // still has its prompt, and a missing context is the model's to notice.
      pack = { focus: [], facts: [], recall: [] };
    }
    const recalled = await hooks.context.recall(policyContext(input, state, { messages: [], tools: offered }, state.step, 0));
    if (recalled && recalled.length > 0) pack = { ...pack, recall: [...pack.recall, ...recalled] };
    state.messages = [{ role: "system", content: systemPrompt(task) }];
  } else {
    const volatile = extractVolatile(transcript);
    if (volatile) pack = volatile;
  }

  // The closing event of a run, emitted exactly once — when the run actually ends.
  // A tick that yields is not an end: the next tick resumes from the saved state and
  // the trace must read as one run, not as one run per tick. Emitting `run.started`
  // again on a resume would make a stepped run's trace longer than a continuous one.
  if (!resumed) await emit(ports.events, { kind: "run.started", step: state.step });

  const kernelHooks: LoopHooks<RunMessage> = {
    beforeTurn: async (ctx) => {
      const view = currentView(transcript, offered);
      const pctx = policyContext(input, state, view, ctx.step, ctx.stepInCall);

      // Steering is drained BEFORE the model is asked, so a message typed mid-run
      // reaches the next call rather than the one after it.
      const steered = ports.steering?.drain() ?? [];
      if (steered.length > 0) {
        const injected = await hooks.steering.inject(pctx, steered);
        const rows = injected ?? steered.map((text): RunMessage => ({ role: "user", content: text }));
        for (const row of rows) transcript.push(row);
        await emit(ports.events, { kind: "tool.dispatched", step: ctx.step, tool: "steer.applied", ok: true });
      }

      const compacted = await hooks.compaction.compact(pctx);
      if (compacted) applyCompaction(state, view, compacted, ctx.step);

      // The volatile block is rebuilt every turn and replaces the previous one, so
      // the cached prefix never holds it.
      const brief = await hooks.memory.brief(pctx);
      replaceVolatile(transcript, turnContextBlock(pack, brief ?? null));

      const decision = await hooks.model.resolve(pctx);
      if (decision) {
        if (decision.model) state.model = { ...state.model, model: decision.model };
      }

      await emit(ports.events, { kind: "turn.started", step: ctx.step });
      return undefined;
    },

    afterTurn: async (ctx, turn) => {
      tally.model = turn.meta && typeof turn.meta === "object" ? (turn.meta as { model?: string }).model : tally.model;
      const usage = turn.meta && typeof turn.meta === "object" ? (turn.meta as { usage?: ModelUsage }).usage : undefined;
      if (usage) tally.usage = usage;
      await emit(ports.events, { kind: "model.completed", step: ctx.step, ...(tally.model ? { model: tally.model } : {}), ...(usage ? { usage } : {}) });
    },

    onNoToolCalls: async (ctx, turn) => {
      // A turn with no tool calls is the model's answer — unless the stall policy
      // says it is narration and the model should be steered back to work.
      const pctx = policyContext(input, state, currentView(transcript, offered), ctx.step, ctx.stepInCall);
      pctx.content = turn.content;
      const stalled = await hooks.stall.recover(pctx);
      if (stalled && stalled.action !== "pause") {
        transcript.push({ role: "user", content: stalled.note ?? "Continue: do the work, do not describe it." });
        return { action: "continue" };
      }
      if (stalled && stalled.action === "pause") {
        return { action: "stop", ok: false, output: stalled.note ?? "paused", finished: true };
      }
      return { action: "finish", output: turn.content };
    },

    beforeDispatch: async (call) => {
      const pctx = policyContext(input, state, currentView(transcript, offered), state.step, 0);
      const decision = await hooks.guards.beforeDispatch(pctx, toPolicyCall(call));
      if (decision?.skip) return { result: { data: decision.skip.data, isError: decision.skip.isError ?? true } };
      return undefined;
    },

    onFinish: async (ctx, summary, call) => {
      const pctx = policyContext(input, state, currentView(transcript, offered), ctx.step, ctx.stepInCall);
      pctx.content = summary;
      pctx.toolCalls = [toPolicyCall(call)];
      const block = await hooks.finish.gate(pctx);
      if (block) {
        state.finish = { ...state.finish, finishBlockedOnce: true };
        return block;
      }
      return null;
    },

    onAskHuman: async (ctx, control, call) => {
      const pctx = policyContext(input, state, currentView(transcript, offered), ctx.step, ctx.stepInCall);
      const answer = await hooks.ask.answer(pctx, control.question);
      if (answer.kind === "answered") {
        transcript.push({ role: "tool", toolCallId: call.id, content: JSON.stringify({ ok: true, answer: answer.answer }) });
      }
    },

    afterDispatch: async (call, result, _message, ctx) => {
      tally.toolCalls += 1;
      if (result.isError) tally.toolErrors += 1;
      const ok = !result.isError && !(result.data && typeof result.data === "object" && (result.data as { ok?: unknown }).ok === false);
      // `ctx.step` is the kernel's live step; `state.step` lags until the loop returns.
      await emit(ports.events, { kind: "tool.dispatched", step: ctx.step, tool: call.name, ok });
      const pctx = policyContext(input, state, currentView(transcript, offered), ctx.step, ctx.stepInCall);
      await hooks.guards.observe(pctx, toPolicyCall(call), result.data);
      rememberWrite(state, call, ok);
      return undefined;
    },

    afterToolCalls: async (ctx) => {
      await emit(ports.events, { kind: "turn.finished", step: ctx.step });
      return undefined;
    },
  };

  let loopResult: LoopResult;
  try {
    loopResult = await runAgentLoop<RunMessage>({
      messages: transcript,
      // Round-trip `M` through the OpenAI shape so the kernel pushes the SAME rows
      // `beforeTurn`/`onAskHuman` push — `state.messages` is OpenAI-shaped after a
      // save, and `resumeState` hands it to the codec verbatim. Emitting a different
      // shape would make a resumed run's transcript diverge from a continuous one.
      codec: {
        assistant: (turn) => ({
          role: "assistant",
          content: turn.content ?? "",
          toolCalls: turn.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
        }),
        tool: (call, result) => ({
          role: "tool",
          toolCallId: call.id,
          content: JSON.stringify(result.data ?? null),
        }),
      },
      ports: {
        complete: (ctx) => completeTurn(input, state, hooks, ctx, offered, transcript),
        dispatch: (call) => dispatchCall(ports, call, signal),
      },
      hooks: kernelHooks,
      budget: { startStep: state.step, ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}), ...(policy.budgets.steps !== undefined ? { stepCap: policy.budgets.steps } : {}) },
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return settle(input, state, transcript, "failed", { reason }, tally);
  }

  state.step = loopResult.step;
  state.messages = transcript;

  if (loopResult.cancelled || signal?.aborted) {
    return settle(input, state, transcript, "failed", { reason: "cancelled" }, tally);
  }
  if (loopResult.awaitingInput) {
    const approvalId = loopResult.awaitingInput.approvalId ?? newApprovalId(state);
    state.askedGates = [...state.askedGates, approvalId];
    return settle(input, state, transcript, "paused", { question: loopResult.awaitingInput.question, approvalId }, tally);
  }
  if (loopResult.exhausted) {
    return settle(input, state, transcript, "failed", { reason: loopResult.exhaustedBy === "failures" ? "tool calls kept failing" : "step budget spent" }, tally);
  }
  if (!loopResult.finished) {
    // The invocation's step budget yielded. The state is saved; the next tick resumes.
    return settle(input, state, transcript, "yielded", {}, tally);
  }
  if (!loopResult.ok) {
    return settle(input, state, transcript, "failed", { reason: loopResult.output || "the run stopped" }, tally);
  }
  return settle(input, state, transcript, "finished", { output: loopResult.output }, tally);
}

/** The view a hook reads: the transcript and the tools as they stand. */
function currentView(transcript: RunMessage[], offered: ToolSchema[]): TurnView {
  return { messages: transcript, tools: offered };
}

/** One model turn: the policy picks the model, the transport answers. */
async function completeTurn(
  input: RunAgentInput,
  state: RunState,
  hooks: PolicyHooks,
  ctx: TurnContext<RunMessage>,
  offered: ToolSchema[],
  transcript: RunMessage[],
): Promise<LoopTurn | { failed: string }> {
  const view = currentView(transcript, offered);
  const pctx = policyContext(input, state, view, ctx.step, ctx.stepInCall);
  const selected = await hooks.tools.select(pctx, offered);
  // An empty selection is a decision, not an absence: a module that returns `[]` has
  // chosen that this run may call nothing. Only `undefined` means "not my concern",
  // which is what the no-op returns until WS2f lands.
  const tools = selected ? [...selected] : offered;
  const decision = await hooks.model.resolve(pctx);
  const model = decision?.model ?? state.model.model ?? input.policy.pinnedModel;

  const request: ModelRequest = {
    messages: transcript,
    ...(model ? { model } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(decision?.maxTokens !== undefined ? { maxTokens: decision.maxTokens } : {}),
  };

  let completion: ModelCompletion;
  try {
    completion = await input.ports.model.complete(request, input.signal);
  } catch (err) {
    if (input.signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { failed: reason };
  }

  if (completion.model) state.model = { ...state.model, model: completion.model };
  return {
    content: completion.content ?? "",
    toolCalls: (completion.toolCalls ?? []).map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
    meta: { model: completion.model, usage: completion.usage },
  };
}

/**
 * Dispatch one tool call through the registry, so the capability gate holds at call
 * time and not only at advertisement. The registry owns the alias remap and the
 * "available tools" list in the unknown-tool error; calling `execute` directly would
 * skip both, and a model that hallucinates `list_dir` would be told the tool does
 * not exist instead of having it run.
 */
async function dispatchCall(ports: RunPorts, call: ParsedToolCall, signal: AbortSignal | undefined): Promise<LoopDispatchResult> {
  try {
    const result = await REGISTRY.dispatch(call.name, call.args, { caps: ports.capabilities, ...(signal ? { signal } : {}) });
    return { data: result.data, ...(result.control ? { control: result.control } : {}), ...(result.data && (result.data as { ok?: unknown }).ok === false ? { isError: true } : {}) };
  } catch (err) {
    if (signal?.aborted) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    return { data: { ok: false, error: reason }, isError: true };
  }
}

/** A tool call as the policy hooks see it. */
function toPolicyCall(call: ParsedToolCall): PolicyToolCall {
  return { id: call.id, name: call.name, args: call.args };
}

/** Record a write the run made, so the finish gates can see what was delivered. */
function rememberWrite(state: RunState, call: ParsedToolCall, ok: boolean): void {
  if (!ok) return;
  if (call.name !== "write_file" && call.name !== "edit_file") return;
  const path = typeof call.args.path === "string" ? call.args.path : undefined;
  if (path && !state.writtenPaths.includes(path)) state.writtenPaths = [...state.writtenPaths, path];
}

/** The volatile block's marker, so a later turn replaces it rather than stacking another. */
const VOLATILE_PREFIX = "<turn-context>";
const VOLATILE_SUFFIX = "</turn-context>";

/** Replace the previous volatile block with this turn's, or append one. */
function replaceVolatile(transcript: RunMessage[], block: string | null): void {
  const index = transcript.findIndex((row) => row.role === "user" && row.content.startsWith(VOLATILE_PREFIX));
  if (!block) {
    if (index >= 0) transcript.splice(index, 1);
    return;
  }
  const row: RunMessage = { role: "user", content: `${VOLATILE_PREFIX}\n${block}\n${VOLATILE_SUFFIX}` };
  if (index >= 0) transcript[index] = row;
  else transcript.push(row);
}

/**
 * The volatile block's inner content, as saved in a resumed transcript, or null when
 * none is present. A resumed run replays the pack it saved (not a rebuilt one), so the
 * volatile block the last turn wrote is reconstructed instead of being dropped.
 */
function extractVolatile(transcript: RunMessage[]): ContextPack | null {
  const row = transcript.find((r) => r.role === "user" && r.content.startsWith(VOLATILE_PREFIX) && r.content.endsWith(VOLATILE_SUFFIX));
  if (!row) return null;
  const inner = row.content.slice(VOLATILE_PREFIX.length, row.content.length - VOLATILE_SUFFIX.length).trim();
  // The block's exact pack is not recoverable field-for-field; what matters for trace
  // fidelity is that a non-empty block is re-rendered (a non-empty focus/facts pack),
  // which keeps the resumed run's volatile row from vanishing.
  return inner ? { focus: [{ path: "<resumed>" }], facts: [], recall: [] } : null;
}

/** An approval id for a pause that named none, stable for the rest of the run. */
function newApprovalId(state: RunState): string {
  return `approval-${state.askedGates.length + 1}`;
}

/** Emit one trace event. A sink that throws must not sink the run. */
async function emit(events: EventSink, event: RunEvent): Promise<void> {
  try {
    await events.emit(event);
  } catch {
    // Telemetry is best-effort. A broken sink records nothing; it does not fail the run.
  }
}

/** What a terminal outcome carries beyond the state. */
interface SettleExtra {
  output?: string;
  question?: string;
  approvalId?: string;
  reason?: string;
}

/**
 * Save the state, write the outcome row, emit the closing event and return the
 * outcome. Every path out of the run comes through here, so a resumed tick and a
 * continuous run record the same row.
 */
async function settle(
  input: RunAgentInput,
  state: RunState,
  transcript: RunMessage[],
  kind: RunOutcome["kind"],
  extra: SettleExtra,
  tally: TurnTally,
): Promise<RunOutcome> {
  state.messages = transcript;

  if (kind === "finished") {
    const consolidated = await composePolicyHooks(input.modules).memory.consolidate(policyContext(input, state, currentView(transcript, []), state.step, 0));
    if (consolidated !== undefined) {
      try {
        await input.ports.store.commitMemory?.(consolidated);
      } catch {
        // A failed write-back is recorded by its absence, not by failing a finished run.
      }
    }
  }

  try {
    await input.ports.store.save(state);
  } catch {
    // A store that cannot save still returns the state to the caller, who holds it.
  }

  const row: RunOutcomeRow = {
    entryPoint: input.policy.entryPoint,
    steps: state.step,
    toolCalls: tally.toolCalls,
    toolErrors: tally.toolErrors,
    terminalStatus: kind,
    ...(tally.model ? { model: tally.model } : {}),
  };
  try {
    await input.ports.events.outcome?.(row);
  } catch {
    // As with the trace: a broken sink records nothing.
  }
  // A yielded tick has not finished: the next tick resumes and the trace is one run.
  // Emitting `run.finished` here would close a run that is still open.
  if (kind !== "yielded") await emit(input.ports.events, { kind: "run.finished", step: state.step, outcome: kind });

  if (kind === "finished") return { kind, output: extra.output ?? "", state };
  if (kind === "paused") return { kind, question: extra.question ?? "", approvalId: extra.approvalId ?? newApprovalId(state), state };
  if (kind === "failed") return { kind, reason: extra.reason ?? "failed", state };
  return { kind, state };
}

/**
 * Read the tool calls off a saved assistant row, so a resumed run sees the same
 * calls the model made. Exposed for the conformance harness; the kernel reads them
 * itself through the codec.
 */
export function readSavedToolCalls(message: unknown): ReturnType<typeof readOpenAiToolCalls> {
  return readOpenAiToolCalls(message);
}
