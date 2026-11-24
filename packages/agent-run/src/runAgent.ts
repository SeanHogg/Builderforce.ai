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
import { reduceRunPolicy } from "@builderforce/run-policy";

import { RUN_CANCELLED_REASON, type ContextPack, type RunMessage, type RunOutcome } from "./contract.js";
import { composePolicyHooks } from "./policy/index.js";
import { turnRouting } from "./policy/model/index.js";
import { portInterruptWatch } from "./policy/steering/index.js";
import { announceRow, appendRows, currentView, emit, policyContext, type RunAgentInput } from "./runContext.js";
import { asMessages, freshState, newApprovalId, resumeState } from "./runState.js";
import { causeOf, completeTurn, dispatchCall, isResumable, offeredSchemas, synthesizeFinal } from "./runTurn.js";
import { nativeOfTurn, toolRow } from "./runRows.js";
import { settle } from "./runSettle.js";
import { kernelHooks, readOnlyPort, type KernelRun } from "./kernelHooks.js";
import { EMPTY_PACK, buildContextPack, openingRows } from "./turnContext.js";
import { planWork } from "./workPlan.js";
import { beginWorkflowStage, measureWorkflow, measureWorkflowSync, workflowScope } from "./telemetry/workflowMetrics.js";
import { workflowHooks } from "./telemetry/workflowHooks.js";
import { freshTally, type RunTally } from "./telemetry/runTally.js";
import { localSpendMeter, usdBudget } from "./policy/budget/usd.js";
import { CacheServedStreak } from "./policy/tools/cacheServedStreak.js";

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
  const hooks = workflowHooks(composePolicyHooks(input.modules), input);
  const state = input.resume ? resumeState(input.resume, policy, task) : freshState(policy, task);
  const resumed = Boolean(input.resume);
  if (state.pipeline === undefined && input.pipeline !== undefined) state.pipeline = input.pipeline;
  if (!state.work && !resumed) measureWorkflowSync(ports.events, workflowScope(input, state.step), 'work', () => {
    if (task.assignedWork?.length) state.work = planWork(task.assignedWork);
    return state.work ?? [];
  }, (work) => ({ assigned: work.length, criteria: work.reduce((n, item) => n + item.criteria.length, 0) }));

  // The run's counters live on its state, so a resumed tick adds to what earlier ticks counted.
  const tally: RunTally = (state.telemetry ??= freshTally());
  const offered = offeredSchemas(ports, { rungs: state.stall?.rungs ?? {} });
  const transcript = asMessages(state.messages);

  // The pack is built ONCE, before turn 1, and carried in the state: a resumed tick
  // renders the same per-turn context tail from it rather than rebuilding (or losing) it.
  let pack: ContextPack = state.context ?? EMPTY_PACK;
  if (!resumed) {
    // Render governing instructions before the host's prepared history or the fresh task.
    const opening = measureWorkflowSync(ports.events, workflowScope(input, state.step), 'opening', () => openingRows(task, policy.approvalGates), (rows) => ({ messages: rows.length }));
    transcript.splice(0, transcript.length, ...opening);
    state.messages = transcript;
    pack = await measureWorkflow(ports.events, { ...workflowScope(input, state.step), operation: 'context_pack' }, 'opening', () => buildContextPack(input, hooks, state, offered), undefined, input.signal);
    state.context = pack;
  }

  // The surface may read the model policy from the live run (and advance it) - handed over once, before the first turn.
  ports.attach?.({
    policy: () => state.model,
    report: (event) => (state.model = reduceRunPolicy(state.model, event)),
    ask: (hasTools) => turnRouting(state.model, hasTools),
  });

  // The opening events of a run, emitted exactly once — when the run actually starts. A
  // resumed tick is not a start: it continues from the saved state and the trace must
  // read as one run, not as one run per tick. The model preflight answers before turn 1.
  if (!resumed) {
    await emit(ports.events, { kind: "run.started", step: state.step });
    // A deterministic answer found before any model call (a PreFetch tool reply) settles the run: no model is asked.
    if (pack.answer && !state.work?.length) {
      appendRows(input, transcript, { role: "assistant", content: pack.answer });
      state.messages = transcript;
      return settle(input, hooks, state, transcript, "finished", { output: pack.answer });
    }
    const preflight = await hooks.model.preflight?.(policyContext(input, state, currentView(transcript, offered), state.step, 0));
    if (preflight) await emit(ports.events, preflight);
    // D1 + D2: a fresh run may start on a weaker model first (the guards decide; a surface with the lever off is unchanged).
    const seeded = await hooks.guards.seed?.(policyContext(input, state, currentView(transcript, offered), state.step, 0));
    if (seeded) state.model = seeded;
  }

  const budget = usdBudget(policy.budgets.usd, ports.spend ?? localSpendMeter());
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
    facts: { refused: false },
    cache: input.cacheStreak ?? new CacheServedStreak(state.reads.servedStreak),
    ...(budget ? { budget } : {}),
  };
  const isReadOnly = readOnlyPort(run);

  let loopResult: LoopResult;
  const kernelDone = beginWorkflowStage(ports.events, workflowScope(input, state.step), 'kernel');
  try {
    loopResult = await runAgentLoop<RunMessage>({
      messages: transcript,
      // The kernel pushes rows in the agent's own shape — the SAME shape a requeue, an
      // answered ask and a steer push — so a saved and resumed transcript reads exactly
      // like a continuous one.
      codec: {
        assistant: (turn) => announceRow(input, {
          role: "assistant",
          content: turn.content ?? "",
          toolCalls: turn.toolCalls.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })),
          ...nativeOfTurn(turn.meta),
        }),
        tool: (call, result) => announceRow(input, toolRow(call.id, result, ports.platform?.verbatimText === true)),
      },
      ports: {
        complete: (ctx) => completeTurn(input, state, hooks, ctx, offered, transcript, pack, run.selection),
        dispatch: (call, ctx) => dispatchCall(input, state, call, run.watch, run.facts, ctx.step),
        ...(isReadOnly ? { isReadOnly } : {}),
      },
      hooks: kernelHooks(run),
      budget: { startStep: state.step, ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}), ...(policy.budgets.steps !== undefined ? { stepCap: policy.budgets.steps } : {}) },
      ...(signal ? { signal } : {}),
    });
    kernelDone(loopResult.cancelled || signal?.aborted ? 'cancelled' : loopResult.finished && !loopResult.ok ? 'failed' : 'completed', { steps: loopResult.step - state.step, toolCalls: tally.toolCalls, toolErrors: tally.toolErrors, tokens: tally.tokens });
  } catch (err) {
    kernelDone(signal?.aborted ? 'cancelled' : 'failed');
    const reason = err instanceof Error ? err.message : String(err);
    return settle(input, hooks, state, transcript, "failed", { reason, ...(signal?.aborted || !isResumable(input, err) ? {} : { cause: err }) });
  }

  state.step = loopResult.step;
  state.messages = transcript;
  state.reads = { ...state.reads, servedStreak: run.cache.state() };

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
    let output: string | null;
    try {
      // A run the failure breaker stopped says so: the closing prompt names the streak (`StallStyle.failureSynthesis`).
      output = await synthesizeFinal(input, state, hooks, transcript, pack, tally, loopResult.exhausted && loopResult.exhaustedBy === "failures" ? { failureStreak: loopResult.failureStreak } : {});
    } catch (err) {
      // Whatever escaped the synthesis turn settles the run the way any other port exception does: the cause rides only when the
      // surface says it is resumable (`synthesizeFinal` rethrows only those); anything else fails the run terminal.
      return settle(input, hooks, state, transcript, "failed", { reason: err instanceof Error ? err.message : String(err), ...(isResumable(input, err) ? { cause: err } : {}) });
    }
    if (output) return settle(input, hooks, state, transcript, "finished", { output });
  }
  if (loopResult.exhausted) {
    return settle(input, hooks, state, transcript, "failed", { reason: loopResult.exhaustedBy === "failures" ? "tool calls kept failing" : "step budget spent", exhausted: true, ...(loopResult.exhaustedBy === "failures" ? { failureStreak: loopResult.failureStreak } : {}) });
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
