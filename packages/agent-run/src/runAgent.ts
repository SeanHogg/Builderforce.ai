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
 * the tool catalog and the model policy are each a hook in `policy/`, and a
 * workstream changes the agent's behaviour by replacing its own folder — never by
 * editing this file.
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
 * state and yields; the next tick resumes from it. The transcript holds only the
 * conversation (the per-turn context tail is rebuilt for each request from the pack
 * the state carries), so the same task run continuously and run one step at a time
 * sends the same requests and produces the same trace — the conformance suite proves it.
 *
 * No `node:*` imports, no DOM: this file is compiled into the Worker, the browser
 * and Node.
 */

import { runAgentLoop, type LoopResult } from "@builderforce/agent-loop";

import { RUN_CANCELLED_REASON, type ContextPack, type RunMessage, type RunOutcome } from "./contract.js";
import { composePolicyHooks } from "./policy/index.js";
import { portInterruptWatch } from "./policy/steering/index.js";
import { currentView, emit, policyContext, type RunAgentInput } from "./runContext.js";
import { asMessages, freshState, newApprovalId, resumeState } from "./runState.js";
import { causeOf, completeTurn, dispatchCall, offeredSchemas, synthesizeFinal } from "./runTurn.js";
import { settle } from "./runSettle.js";
import { kernelHooks, readOnlyPort, type KernelRun } from "./kernelHooks.js";
import { EMPTY_PACK, buildContextPack, openingRows } from "./turnContext.js";
import { freshTally, type RunTally } from "./telemetry/runTally.js";

export type { RunAgentInput } from "./runContext.js";

/**
 * Drive one run to an outcome.
 *
 * The kernel owns the loop; this function owns the meaning of a turn. It asks the
 * model through the transport, dispatches each tool call through the registry (so
 * the capability gate is enforced at call time, not just at advertisement), and
 * asks each policy hook at the point the PRD names (`kernelHooks.ts`).
 */
export async function runAgent(input: RunAgentInput): Promise<RunOutcome> {
  const { task, policy, ports, signal } = input;
  const hooks = composePolicyHooks(input.modules);
  const state = input.resume ? resumeState(input.resume, policy, task) : freshState(policy, task);
  const resumed = Boolean(input.resume);

  // The run's counters live on its state, so a resumed tick adds to what earlier ticks counted.
  const tally: RunTally = (state.telemetry ??= freshTally());
  const offered = offeredSchemas(ports);
  const transcript = asMessages(state.messages);

  // The pack is built ONCE, before turn 1, and carried in the state: a resumed tick
  // renders the same per-turn context tail from it rather than rebuilding (or losing) it.
  let pack: ContextPack = state.context ?? EMPTY_PACK;
  if (!resumed) {
    // The system prompt opens the transcript the kernel drives — the task reaches the
    // model on turn 1, and every saved state carries it.
    transcript.splice(0, transcript.length, ...openingRows(task));
    state.messages = transcript;
    pack = await buildContextPack(input, hooks, state, offered);
    state.context = pack;
  }

  // The opening events of a run, emitted exactly once — when the run actually starts. A
  // resumed tick is not a start: it continues from the saved state and the trace must
  // read as one run, not as one run per tick. The model preflight answers before turn 1.
  if (!resumed) {
    await emit(ports.events, { kind: "run.started", step: state.step });
    const preflight = await hooks.model.preflight?.(policyContext(input, state, currentView(transcript, offered), state.step, 0));
    if (preflight) await emit(ports.events, preflight);
    // D1 + D2: a fresh run may start on a weaker model first (the guards decide; a surface with the lever off is unchanged).
    const seeded = await hooks.guards.seed?.(policyContext(input, state, currentView(transcript, offered), state.step, 0));
    if (seeded) state.model = seeded;
  }

  const run: KernelRun = {
    input,
    state,
    hooks,
    transcript,
    offered,
    tally,
    watch: portInterruptWatch(ports.steering),
    turnContent: "",
    stopped: false,
  };
  const isReadOnly = readOnlyPort(run);

  let loopResult: LoopResult;
  try {
    loopResult = await runAgentLoop<RunMessage>({
      messages: transcript,
      // The kernel pushes rows in the agent's own shape — the SAME shape a requeue, an
      // answered ask and a steer push — so a saved and resumed transcript reads exactly
      // like a continuous one.
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
        complete: (ctx) => completeTurn(input, state, hooks, ctx, offered, transcript, pack),
        dispatch: (call) => dispatchCall(input, state, call, run.watch),
        ...(isReadOnly ? { isReadOnly } : {}),
      },
      hooks: kernelHooks(run),
      budget: { startStep: state.step, ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}), ...(policy.budgets.steps !== undefined ? { stepCap: policy.budgets.steps } : {}) },
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return settle(input, hooks, state, transcript, "failed", { reason, ...(signal?.aborted ? {} : { cause: err }) });
  }

  state.step = loopResult.step;
  state.messages = transcript;

  // A Stop, or a steered stop command: the run settles cancelled, with no further turn.
  if (run.stopped || loopResult.cancelled || signal?.aborted) {
    return settle(input, hooks, state, transcript, "failed", { reason: RUN_CANCELLED_REASON });
  }
  if (loopResult.awaitingInput) {
    const approvalId = loopResult.awaitingInput.approvalId ?? newApprovalId(state);
    state.askedGates = [...state.askedGates, approvalId];
    return settle(input, hooks, state, transcript, "paused", { question: loopResult.awaitingInput.question, approvalId });
  }
  // A run that ended without an answer — a budget spent, a breaker tripped, a finish
  // with nothing to say — gets the ONE forced no-tools turn before it settles (§6.2).
  if (loopResult.exhausted || (loopResult.finished && loopResult.ok && !loopResult.output.trim())) {
    const output = await synthesizeFinal(input, state, hooks, transcript, pack, tally);
    if (output) return settle(input, hooks, state, transcript, "finished", { output });
  }
  if (loopResult.exhausted) {
    return settle(input, hooks, state, transcript, "failed", { reason: loopResult.exhaustedBy === "failures" ? "tool calls kept failing" : "step budget spent", exhausted: true });
  }
  if (!loopResult.finished) {
    // The invocation's step budget yielded. The state is saved; the next tick resumes.
    return settle(input, hooks, state, transcript, "yielded", {});
  }
  if (!loopResult.ok) {
    const cause = causeOf(state);
    return settle(input, hooks, state, transcript, "failed", { reason: loopResult.output || "the run stopped", ...(cause !== undefined ? { cause } : {}) });
  }
  return settle(input, hooks, state, transcript, "finished", { output: loopResult.output });
}
