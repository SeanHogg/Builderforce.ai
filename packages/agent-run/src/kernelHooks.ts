/**
 * The kernel's hooks: WHEN each policy hook runs inside one turn. Split out of
 * `runAgent.ts` so the driver holds only setup, the loop call and the outcome (PRD 35 §5
 * rule 4). Every decision here belongs to a policy module; this file only orders the
 * calls and applies what they return to the transcript and the trace. It never branches
 * on `RunPolicy.entryPoint`.
 */

import type { LoopControl, LoopDispatchResult, LoopHooks, ParsedToolCall } from "@builderforce/agent-loop";

import type { ModelUsage, RunMessage, RunState } from "./contract.js";
import type { GuardControl, PolicyContext, PolicyHooks } from "./policy/index.js";
import { isStopSteer, steerInput, steerSkip, type InterruptWatch } from "./policy/steering/index.js";
import { applyCompaction, currentView, emit, policyContext, toPolicyCall, type RunAgentInput } from "./runContext.js";
import { rememberWrite } from "./runState.js";
import { tallyCall, tallyTurn, tallyVerify, type RunTally } from "./telemetry/runTally.js";
import type { ToolSchema } from "@builderforce/agent-tools";

/** The tools a run asks a human through — held back while a requested delegation is undone. */
const ASK_TOOLS: ReadonlySet<string> = new Set(["ask_human", "ask_user"]);

/** What the kernel hooks share with the driver across one invocation. */
export interface KernelRun {
  input: RunAgentInput;
  state: RunState;
  hooks: PolicyHooks;
  transcript: RunMessage[];
  offered: ToolSchema[];
  tally: RunTally;
  /** Where an interrupting steer is watched (the steering port). */
  watch: InterruptWatch;
  /** The current turn's text, for the guards' turn fold (A3's readiness claims). */
  turnContent: string;
  /** A steered stop command arrived: the run settles cancelled, no further model turn. */
  stopped: boolean;
}

/** A guard's control as the kernel's control: the options ride along for the ask hook. */
function asLoopControl(control: GuardControl): LoopControl {
  return control as LoopControl;
}

/** The answers a parked `ask_human` offers, when the control that parked it named them. */
function optionsOf(control: unknown): readonly string[] | undefined {
  const options = (control as { options?: unknown }).options;
  return Array.isArray(options) ? options.filter((o): o is string => typeof o === "string") : undefined;
}

/** Rewrite a pushed tool row so the model reads the replacement result. */
function rewriteRow(row: RunMessage, data: unknown): void {
  row.content = JSON.stringify(data ?? null);
}

/** The kernel hooks for one invocation of the run. */
export function kernelHooks(run: KernelRun): LoopHooks<RunMessage> {
  const { input, state, hooks, transcript, offered, tally } = run;
  const { ports, policy } = input;

  const contextAt = (step: number, turn: number): PolicyContext => policyContext(input, state, currentView(transcript, offered), step, turn);

  /**
   * Send a turn back instead of accepting it: what the model said stays in the
   * transcript as its own row, then the correction — so the next turn reads both, never
   * two user rows in a row with the model's words lost.
   */
  const requeue = (said: string, note: string): void => {
    if (said.trim()) transcript.push({ role: "assistant", content: said });
    transcript.push({ role: "user", content: note });
  };

  /** The verify a finish waits on (`RunPolicy.verify`): a failing verdict refuses it. */
  const verifyBlock = async (pctx: PolicyContext): Promise<string | null> => {
    if (policy.verify === "none") return null;
    const verdict = await hooks.verify.verify(pctx);
    if (verdict) tallyVerify(tally, verdict.ok);
    return verdict && !verdict.ok ? verdict.note ?? "Verification failed: fix it before finishing." : null;
  };

  // The results a covered read was answered with: no tool ran, so none of them is a
  // served read, a write, a counted call or a fact for memory — only a stub the model reads.
  const stubs = new WeakSet<LoopDispatchResult>();

  return {
    beforeTurn: async (ctx) => {
      // Steering is drained BEFORE the model is asked, so a message typed mid-run reaches
      // the next call rather than the one after it. A stop command ends the run here:
      // the model never gets another turn after a stop (§6.3).
      const steered = (ports.steering?.drain() ?? []).map(steerInput);
      if (steered.length > 0) {
        const texts = steered.map((s) => s.text);
        if (isStopSteer(texts)) {
          run.stopped = true;
          return { action: "stop", ok: false, output: "cancelled", finished: true };
        }
        const injected = await hooks.steering.inject(contextAt(ctx.step, ctx.stepInCall), texts);
        const rows = injected ?? texts.map((text): RunMessage => ({ role: "user", content: text }));
        for (const row of rows) transcript.push(row);
        for (let i = 0; i < steered.length; i += 1) await emit(ports.events, { kind: "steer.applied", step: ctx.step });
      }

      const view = currentView(transcript, offered);
      const compacted = await hooks.compaction.compact(policyContext(input, state, view, ctx.step, ctx.stepInCall));
      if (compacted) applyCompaction(state, view, compacted, ctx.step);

      await emit(ports.events, { kind: "turn.started", step: ctx.step });
      return undefined;
    },

    afterTurn: async (ctx, turn) => {
      run.turnContent = turn.content ?? "";
      const meta = turn.meta && typeof turn.meta === "object" ? (turn.meta as { model?: string; usage?: ModelUsage }) : undefined;
      const model = meta ? meta.model : tally.model;
      const usage = meta?.usage;
      tallyTurn(tally, model, usage);
      await emit(ports.events, { kind: "model.completed", step: ctx.step, ...(model ? { model } : {}), ...(usage ? { usage } : {}) });
    },

    onNoToolCalls: async (ctx, turn) => {
      // A turn with no tool calls is the model's answer — unless the stall policy says it
      // is narration, or the run may not settle yet.
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      pctx.content = turn.content;
      const stalled = await hooks.stall.recover(pctx);
      if (stalled && stalled.action === "pause") {
        return { action: "stop", ok: false, output: stalled.note ?? "paused", finished: true };
      }
      if (stalled) {
        requeue(turn.content, stalled.note ?? "Continue: do the work, do not describe it.");
        return { action: "continue" };
      }
      // A prose answer is a finish too: the sign-off a reviewer owes and the sub-agents
      // the user asked for hold it exactly as they hold the `finish` tool.
      const block = hooks.finish.settleBlock(pctx) ?? hooks.subagents.backstop(pctx);
      if (block) {
        requeue(turn.content, block);
        return { action: "continue" };
      }
      const output = hooks.stall.settle ? hooks.stall.settle(pctx, turn.content) : turn.content;
      if (output.trim()) transcript.push({ role: "assistant", content: output });
      return { action: "finish", output };
    },

    beforeDispatch: async (call, ctx) => {
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      const pcall = toPolicyCall(call);
      // A3's pause parks the run on a person (the control); any other skip just answers.
      const decision = await hooks.guards.beforeDispatch(pctx, pcall);
      if (decision?.skip) {
        const { data, isError, control } = decision.skip;
        return { result: { data, isError: isError ?? true, ...(control ? { control: asLoopControl(control) } : {}) } };
      }
      // A run about to ASK while the sub-agents it was asked for are undone is told to
      // start them instead — the question it would ask is the one the user answered.
      if (ASK_TOOLS.has(call.name)) {
        const note = hooks.subagents.backstop(pctx);
        if (note) return { result: { data: { ok: false, error: note }, isError: true } };
      }
      // Read coverage: a read whose lines were already served is answered without the disk.
      const covered = hooks.tools.beforeDispatch?.(pctx, pcall);
      if (covered) {
        const stub: LoopDispatchResult = { data: covered.data };
        stubs.add(stub);
        return { result: stub };
      }
      return undefined;
    },

    onFinish: async (ctx, summary, call) => {
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      pctx.content = summary;
      pctx.toolCalls = [toPolicyCall(call)];
      // The verify runs first: a finish the declared checks refuse never reaches the gates.
      const block = (await verifyBlock(pctx)) ?? (await hooks.finish.gate(pctx)) ?? hooks.subagents.backstop(pctx);
      if (block) {
        state.finish = { ...state.finish, finishBlockedOnce: true };
        return block;
      }
      return null;
    },

    onAskHuman: async (ctx, control) => {
      const answer = await hooks.ask.answer(contextAt(ctx.step, ctx.stepInCall), control.question, optionsOf(control));
      // Answered in-run: the kernel puts the answer in the call's own row and does not park
      // the run. Anything else returns nothing, and the run pauses on the person.
      if (answer.kind === "answered") return { data: { ok: true, answer: answer.answer } };
      return undefined;
    },

    afterDispatch: async (call, result, message, ctx) => {
      const stub = stubs.has(result);
      const ok = !result.isError && !(result.data && typeof result.data === "object" && (result.data as { ok?: unknown }).ok === false);
      if (!stub) {
        // The trace and the tally fold the same verdict, so the outcome row and the
        // event trace never disagree (telemetry/eventTally.ts).
        tallyCall(tally, ctx.step, call.name, call.args, result.data, ok);
        // `ctx.step` is the kernel's live step; `state.step` lags until the loop returns.
        await emit(ports.events, { kind: "tool.dispatched", step: ctx.step, tool: call.name, ok });
      }
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      const pcall = toPolicyCall(call);
      // What the model reads on this call: D7's post-edit note, then the early delegation
      // nudge on the read that earned it. Applied to the row the kernel already pushed.
      let data = result.data;
      const noted = await hooks.guards.observe(pctx, pcall, data);
      if (noted) data = noted.data;
      const nudged = hooks.subagents.nudge(pctx, pcall, data);
      if (nudged) data = nudged.data;
      if (data !== result.data) rewriteRow(message, data);
      if (!stub) {
        hooks.tools.observe?.(pctx, pcall, data, result.isError === true);
        await hooks.memory.observe?.(pctx, pcall, result.data, result.isError);
        rememberWrite(state, call, ok);
      }
      // An interrupting steer skips the rest of this turn's calls (§6.3).
      return steerSkip(run.watch);
    },

    afterToolCalls: async (ctx) => {
      // The guards fold the turn: D1's cascade and A3's trips, readiness claims included.
      // A turn that acted was not a stall, so the re-prompt budget starts full again.
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      await hooks.guards.endTurn?.(pctx, run.turnContent);
      hooks.stall.acted?.(pctx);
      await emit(ports.events, { kind: "turn.finished", step: ctx.step });
      return undefined;
    },
  };
}

/** D8: the kernel's read-only port, from the guards policy (lever off ⇒ every call sequential). */
export function readOnlyPort(run: KernelRun): ((call: ParsedToolCall) => boolean) | undefined {
  const guards = run.hooks.guards;
  if (!guards.isReadOnly) return undefined;
  return (call) => guards.isReadOnly?.(policyContext(run.input, run.state, currentView(run.transcript, run.offered), run.state.step, 0), call.name) ?? false;
}
