/**
 * The kernel's hooks: WHEN each policy hook runs inside one turn. Split out of
 * `runAgent.ts` so the driver holds only setup, the loop call and the outcome (PRD 35 §5
 * rule 4). Every decision here belongs to a policy module; this file only orders the
 * calls and applies what they return to the transcript and the trace. It never branches
 * on `RunPolicy.entryPoint`.
 */

import type { LoopControl, LoopDispatchResult, LoopHooks, ParsedToolCall } from "@builderforce/agent-loop";

import { RUN_CANCELLED_REASON, type ModelUsage, type RunMessage, type RunState } from "./contract.js";
import type { GuardControl, PolicyContext, PolicyHooks } from "./policy/index.js";
import { steerSkip, type InterruptWatch } from "./policy/steering/index.js";
import { steeringTakers } from "./kernelSteering.js";
import { noToolCallsHook } from "./kernelNoTools.js";
import { appendRows, applyCompaction, currentView, emit, policyContext, toPolicyCall, type RunAgentInput, type TurnFacts } from "./runContext.js";
import { rememberWrite } from "./runState.js";
import { callKinds, ownsCall, type TurnSelection } from "./runTurn.js";
import { nativeOfTurn } from "./runRows.js";
import { volatileTail } from "./policy/compaction/pack.js";
import type { UsdBudget } from "./policy/budget/usd.js";
import type { CacheServedStreak } from "./policy/tools/cacheServedStreak.js";
import { lastFinishReason } from "./policy/finish/index.js";
import { tallyCall, tallyTurn, tallyVerify, type RunTally } from "./telemetry/runTally.js";
import type { ToolSchema } from "@builderforce/agent-tools";
import type { TurnInterruption } from "./surface.js";

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
  /** The current turn's native blocks and fields, put back on any row that restates what the model said. */
  turnNative?: Pick<RunMessage, "parts" | "meta">;
  /** A steered stop command arrived: the run settles cancelled, no further model turn. */
  stopped: boolean;
  /** How the turn that just ended was served, for the hooks and dispatch that follow it. */
  facts: TurnFacts;
  /** The tools policy's selection for THIS step, made once in `beforeTurn` and reused by the request. */
  selection?: TurnSelection;
  /** The calls in a row the read cache answered (the no-progress breaker's count). */
  cache: CacheServedStreak;
  /** The run's hold on its USD cap (`RunPolicy.budgets.usd`); absent when the run has none. */
  budget?: UsdBudget;
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
function rewriteRow(row: RunMessage, data: unknown, verbatim: boolean): void {
  row.content = verbatim && typeof data === "string" ? data : JSON.stringify(data ?? null);
}

/** The kernel hooks for one invocation of the run. */
export function kernelHooks(run: KernelRun): LoopHooks<RunMessage> {
  const { input, state, hooks, transcript, offered, tally } = run;
  const { ports, policy } = input;

  const contextAt = (step: number, turn: number): PolicyContext => policyContext(input, state, currentView(transcript, offered), step, turn);
  const append = (...rows: RunMessage[]): void => appendRows(input, transcript, ...rows);

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
  // The results of a call the run PARKED on a person (a governance gate, A3's pause): the call never ran, so it is no counted
  // call and no error; the retry after the answer is the call that counts.
  const held = new WeakSet<LoopDispatchResult>();
  /** When each call started, so a call's duration is MEASURED, not inferred from the events around it. */
  const starts = new Map<string, number>();

  const { takeSteers, takeJoined, lateSteerNote, takeFollowUps } = steeringTakers(run, contextAt);

  return {
    beforeTurn: async (ctx) => {
      // The run's USD cap is held first: at the cap the run stops with a contained answer before any other work of the step;
      // at 80% the model is told once to converge, in the volatile tail's own tagged row.
      const verdict = run.budget?.beforeTurn();
      if (verdict?.kind === "contain") {
        append({ role: "assistant", content: verdict.text });
        await emit(ports.events, { kind: "budget.contained", step: ctx.step, spentMc: verdict.spentMc, capMc: verdict.capMc, unpricedCalls: verdict.unpricedCalls, text: verdict.text });
        return { action: "stop", ok: true, finished: true, output: verdict.text };
      }
      if (verdict?.kind === "warn") {
        const tail = volatileTail([verdict.text]);
        if (tail) append({ role: tail.role as RunMessage["role"], content: String(tail.content) });
        await emit(ports.events, { kind: "budget.warning", step: ctx.step, spentMc: verdict.spentMc, capMc: verdict.capMc, unpricedCalls: verdict.unpricedCalls, text: verdict.text });
      }
      // Steering is drained BEFORE the model is asked, so a message typed mid-run reaches
      // the next call rather than the one after it.
      if ((await takeSteers(ctx)) === "stop") return { action: "stop", ok: false, output: RUN_CANCELLED_REASON, finished: true };

      // Compaction charges the schemas the model will be SHOWN, not every tool the surface
      // could run: a board with hundreds of tools advertises a fixed, ranked set.
      const base = currentView(transcript, offered);
      const selectNow = async (): Promise<readonly ToolSchema[] | void> => hooks.tools.select(policyContext(input, state, base, ctx.step, ctx.stepInCall), offered);
      // The surface may shape the turn (force it, add to the menu); it is asked once per step, and the policy's selection is its input.
      const menu = await ports.platform?.turn?.({
        step: ctx.step,
        select: async () => (await selectNow()) ?? offered,
        progress: { rungs: state.stall?.rungs ?? {} },
        cache: run.cache,
      });
      const advertised = menu?.tools ?? (await selectNow());
      run.selection = {
        tools: advertised,
        ...(menu?.toolChoice ? { toolChoice: menu.toolChoice } : {}),
        ...(menu?.tail && menu.tail.length > 0 ? { tail: menu.tail } : {}),
      };
      const view = advertised ? { ...base, tools: [...advertised] } : base;
      const compacted = await hooks.compaction.compact(policyContext(input, state, view, ctx.step, ctx.stepInCall));
      if (compacted) {
        applyCompaction(state, view, compacted, ctx.step);
        await emit(ports.events, {
          kind: "context.compacted", step: ctx.step, dropped: compacted.dropped,
          ...(compacted.beforeTokens !== undefined ? { beforeTokens: compacted.beforeTokens } : {}),
          ...(compacted.afterTokens !== undefined ? { afterTokens: compacted.afterTokens } : {}),
          ...(compacted.summarized !== undefined ? { summarized: compacted.summarized } : {}),
          ...(compacted.masked ? { masked: compacted.masked } : {}),
          ...(compacted.note ? { note: compacted.note } : {}),
          ...(compacted.covered !== undefined ? { covered: compacted.covered } : {}),
        });
      }

      // What the previous step's completion said about itself ends with that step: a step that
      // yields nothing (`{ skip: true }`, a provider re-route) must not leave it for the next.
      run.facts.model = undefined;
      run.facts.interruption = undefined;

      await emit(ports.events, { kind: "turn.started", step: ctx.step });
      return undefined;
    },

    afterTurn: async (ctx, turn) => {
      run.turnContent = turn.content ?? "";
      run.turnNative = nativeOfTurn(turn.meta);
      const meta = turn.meta && typeof turn.meta === "object" ? (turn.meta as { model?: string; usage?: ModelUsage; interrupted?: TurnInterruption }) : undefined;
      const model = meta ? meta.model : tally.model;
      const usage = meta?.usage;
      run.facts.model = meta?.model;
      run.facts.interruption = meta?.interrupted;
      tallyTurn(tally, model, usage);
      if (run.budget?.afterTurn(usage)) await emit(ports.events, { kind: "budget.unpriced", step: ctx.step, ...(model ? { model } : {}) });
      await emit(ports.events, { kind: "model.completed", step: ctx.step, ...(model ? { model } : {}), ...(usage ? { usage } : {}) });
    },

    onNoToolCalls: noToolCallsHook(run, { contextAt, append, takeSteers, takeJoined, takeFollowUps }),

    onRepetitionLoop: async (ctx, loop) => {
      await emit(ports.events, { kind: "loop.repetition", step: ctx.step, copies: loop.copies, block: loop.block });
    },

    beforeToolCalls: (_ctx, turn, calls) => {
      // A turn whose calls end the run before any of them dispatches (an addressed reply's `ask_user`).
      const output = ports.extensions?.terminalTurn?.({ content: turn.content ?? "" }, calls.map((c) => ({ name: c.name, args: c.args, malformed: c.malformed })));
      return output === undefined ? undefined : { action: "stop", ok: true, output, finished: true };
    },

    beforeDispatch: async (call, ctx) => {
      starts.set(call.id, Date.now());
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      const pcall = toPolicyCall(call);
      // Governance gates (`RunPolicy.approvalGates`): a block refuses the call, an approval
      // asks the human channel and parks the run on the approver.
      const gated = await hooks.tools.gate?.(pctx, pcall);
      if (gated) {
        const refused: LoopDispatchResult = { data: gated.data, isError: true, ...(gated.control ? { control: asLoopControl(gated.control) } : {}) };
        if (gated.control) held.add(refused);
        return { result: refused };
      }
      // A3's pause parks the run on a person (the control); any other skip just answers.
      const decision = await hooks.guards.beforeDispatch(pctx, pcall);
      if (decision?.skip) {
        const { data, isError, control } = decision.skip;
        const skipped: LoopDispatchResult = { data, isError: isError ?? true, ...(control ? { control: asLoopControl(control) } : {}) };
        if (control) held.add(skipped);
        return { result: skipped };
      }
      // A run about to ASK while the sub-agents it was asked for are undone is told to
      // start them instead — the question it would ask is the one the user answered.
      if (ASK_TOOLS.has(call.name)) {
        const note = hooks.subagents.backstop(pctx);
        if (note) return { result: { data: { ok: false, error: note }, isError: true } };
      }
      // A meta tool (tool_search, update_task_state) is the policy's own answer — still a CALL: tallied, traced, observed.
      const meta = hooks.tools.meta?.(pctx, pcall);
      if (meta) return { result: { data: meta.data } };
      // Read coverage: a read whose lines were already served is answered without the disk.
      const covered = hooks.tools.beforeDispatch?.(pctx, pcall);
      if (covered) {
        const stub: LoopDispatchResult = { data: covered.data };
        stubs.add(stub);
        // The run asked for what it already holds: the cache answered, and a run that does little else is circling.
        run.cache.served(ctx.step);
        return { result: stub };
      }
      // The surface's own say over the call (`PlatformTools.preflight`): here, where the loop does not race it against the person's Stop.
      const platform = ports.platform;
      if (platform?.preflight && ownsCall(ports, call.name)) {
        const pre = await platform.preflight({ id: call.id, name: call.name, args: call.args, arguments: call.raw.arguments, malformed: call.malformed }, { step: ctx.step });
        if (pre && "result" in pre) return { result: { data: pre.result.data, ...(pre.result.isError ? { isError: true } : {}) } };
        if (pre && "rewrite" in pre) {
          const { name, args } = pre.rewrite;
          return { rewrite: { ...call, name, args, raw: { ...call.raw, name, arguments: JSON.stringify(args) } } };
        }
      }
      return undefined;
    },

    onFinish: async (ctx, summary, call) => {
      const pctx = contextAt(ctx.step, ctx.stepInCall);
      pctx.content = summary;
      pctx.toolCalls = [toPolicyCall(call)];
      // The verify runs first: a finish the declared checks refuse never reaches the gates.
      const verifyRefused = await verifyBlock(pctx);
      const gated = verifyRefused ?? (await hooks.finish.gate(pctx));
      // D1: the cascade learns the NAMED verdict of this finish attempt (a red CI is the model's failure, CI still running is not).
      // A refusal by the verify phase is not a finish gate's: it carries no gate reason.
      const judged = hooks.guards.finish ? await hooks.guards.finish(pctx, { block: gated, reason: verifyRefused ? "verify" : lastFinishReason(state) }) : gated;
      const block = judged ?? hooks.subagents.backstop(pctx);
      if (block) {
        state.finish = { ...state.finish, finishBlockedOnce: true };
        return block;
      }
      // A message steered in while this finish was in flight is never lost (§6.3): the call
      // is answered with it instead, so the run takes one more turn for it. (The steer is NOT
      // spliced into the transcript here — the finish call's own result row must follow the
      // assistant row that made it.)
      return lateSteerNote(ctx);
    },

    onAskHuman: async (ctx, control) => {
      // The approver's channel already answered 'paused': the run parks on that record. Asking
      // again could answer in-run and report a call that never ran as done.
      if ((control as { parked?: true }).parked) return undefined;
      const answer = await hooks.ask.answer(contextAt(ctx.step, ctx.stepInCall), control.question, optionsOf(control));
      // Answered in-run: the kernel puts the answer in the call's own row and does not park
      // the run. Anything else returns nothing, and the run pauses on the person.
      if (answer.kind === "answered") return { data: { ok: true, answer: answer.answer } };
      return undefined;
    },

    afterDispatch: async (call, result, message, ctx) => {
      const stub = stubs.has(result) || held.has(result);
      // What the call was, for the no-progress count: a surface's cached or conversational answer is not a run of the host.
      const kind = callKinds.get(result);
      if (!stub) {
        if (kind === "cached") run.cache.served(ctx.step);
        else if (kind !== "neutral") run.cache.ran();
      }
      const ok = !result.isError && !(result.data && typeof result.data === "object" && (result.data as { ok?: unknown }).ok === false);
      if (!stub) {
        // The trace and the tally take the same verdict, so the outcome row and the
        // event trace never disagree.
        tallyCall(tally, ctx.step, call.name, call.args, result.data, ok);
        // `ctx.step` is the kernel's live step; `state.step` lags until the loop returns.
        await emit(ports.events, { kind: "tool.dispatched", step: ctx.step, tool: call.name, ok, callId: call.id, args: call.args, result: result.data }, { durationMs: Date.now() - (starts.get(call.id) ?? Date.now()) });
        starts.delete(call.id);
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
      if (data !== result.data) rewriteRow(message, data, message.parts !== undefined || ports.platform?.verbatimText === true);
      if (!stub) {
        hooks.tools.observe?.(pctx, pcall, data, result.isError === true);
        // The run's memory is the WORKSPACE's (files read and written, searches made); a
        // call on the surface's own tools acted on its board, not on this work.
        if (!ownsCall(ports, call.name)) await hooks.memory.observe?.(pctx, pcall, result.data, result.isError);
        rememberWrite(state, call, ok);
      }
      // A call the run parked on an approver ends the turn's dispatching: nothing after it may run while the run waits on a
      // person (the retry after the answer re-asks for them).
      if (held.has(result) && (result.control as { parked?: true } | undefined)?.parked) {
        return { skipRemaining: { data: { ok: false, skipped: true, error: "Not run: the run is parked on an approval." }, isError: false } };
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
      await ports.platform?.turnEnded?.({ step: ctx.step });
      // A round in which a call was declined says, ONCE, how to stop it recurring — after
      // the complete calls ran and the declined one got its own result.
      if (run.facts.refused) {
        run.facts.refused = false;
        const directive = ports.platform?.malformed?.roundDirective(run.facts.interruption === "truncated");
        if (directive) append({ role: "system", content: directive });
      }
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
