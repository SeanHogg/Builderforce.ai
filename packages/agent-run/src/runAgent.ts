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

import { readOpenAiToolCalls, runAgentLoop, type LoopHooks, type LoopResult } from "@builderforce/agent-loop";

import type { ContextPack, ModelUsage, RunMessage, RunOutcome } from "./contract.js";
import { composePolicyHooks } from "./policy/index.js";
import { applyCompaction, currentView, emit, policyContext, toPolicyCall, type RunAgentInput, type TurnTally } from "./runContext.js";
import { asMessages, freshState, newApprovalId, rememberWrite, resumeState } from "./runState.js";
import { completeTurn, dispatchCall, offeredSchemas } from "./runTurn.js";
import { settle } from "./runSettle.js";
import { extractVolatile, replaceVolatile, systemPrompt, turnContextBlock } from "./turnContext.js";

export type { RunAgentInput } from "./runContext.js";

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
  /** The current turn's text, for the guards' turn fold (A3's readiness claims). */
  let turnContent = "";
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
      turnContent = turn.content ?? "";
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
      // The guards fold the turn: D1's cascade and A3's trips, readiness claims included.
      const pctx = policyContext(input, state, currentView(transcript, offered), ctx.step, ctx.stepInCall);
      await hooks.guards.endTurn?.(pctx, turnContent);
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

/**
 * Read the tool calls off a saved assistant row, so a resumed run sees the same
 * calls the model made. Exposed for the conformance harness; the kernel reads them
 * itself through the codec.
 */
export function readSavedToolCalls(message: unknown): ReturnType<typeof readOpenAiToolCalls> {
  return readOpenAiToolCalls(message);
}
