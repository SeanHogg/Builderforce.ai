/**
 * THE agent loop.
 *
 * Every BuilderForce surface — the cloud Durable Object, rehearsal, the server-side
 * Brain reply, the embedded browser Brain, the creation canvas, the on-prem runtime —
 * drives this ONE function. It owns the model→tools→model skeleton and nothing else;
 * see `types.ts` for the seams where each surface plugs in its own behaviour.
 *
 * Failure policy: the kernel does not catch. A throwing port aborts the run and the
 * surface's own try/finally records it, exactly as before consolidation. The single
 * exception is an abort signal firing mid-port — that is reported as `cancelled`, not
 * rethrown, because every surface treated it that way.
 */

import {
  DEFAULT_TOOL_FAILURE_STREAK,
  type AfterToolCallsDecision,
  type LoopDispatchResult,
  type LoopResult,
  type LoopRunArgs,
  type LoopTurn,
  type LoopTurnResult,
  type ParsedToolCall,
  type TurnContext,
} from "./types.js";
import { parseToolCall } from "./parseToolCall.js";

class Ctx<M> implements TurnContext<M> {
  step = 0;
  stepInCall = 0;
  output = "";
  failureStreak = 0;
  constructor(
    readonly messages: M[],
    readonly signal: AbortSignal | undefined,
  ) {}
}

export async function runAgentLoop<M>(args: LoopRunArgs<M>): Promise<LoopResult> {
  const { codec, ports, budget, signal } = args;
  const hooks = args.hooks ?? {};
  const ctx = new Ctx<M>(args.messages, signal);
  const startStep = Math.max(0, budget.startStep ?? 0);
  const maxThisCall = budget.maxSteps ?? Number.POSITIVE_INFINITY;
  const stepCap = budget.stepCap ?? Number.POSITIVE_INFINITY;
  const failureStreakCap = budget.failureStreakCap ?? DEFAULT_TOOL_FAILURE_STREAK;
  ctx.step = startStep;
  ctx.output = args.initialOutput ?? "";

  let ok = true;
  let finished = false;
  let cancelled = false;
  // The tool-failure breaker tripped: the run's last `failureStreakCap` dispatches all
  // failed, so it is stuck, not working. The ONLY limit a conversational run has.
  let failuresTripped = false;
  let awaitingInput: LoopResult["awaitingInput"];

  const isCancelled = async (): Promise<boolean> =>
    Boolean(signal?.aborted) || Boolean(await hooks.isCancelled?.(ctx));

  for (; ctx.step < stepCap && !finished && ctx.stepInCall < maxThisCall; ctx.step++, ctx.stepInCall++) {
    if (await isCancelled()) {
      cancelled = true;
      break;
    }

    const before = await hooks.beforeTurn?.(ctx);
    if (before?.action === "stop") {
      ok = before.ok ?? false;
      if (before.output !== undefined) ctx.output = before.output;
      finished = before.finished ?? true;
      break;
    }

    let turnResult!: LoopTurnResult;
    try {
      turnResult = await ports.complete(ctx);
    } catch (err) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      throw err;
    }
    if ("skip" in turnResult) continue;
    if ("failed" in turnResult) {
      ok = false;
      ctx.output = turnResult.failed;
      finished = true;
      break;
    }
    const turn: LoopTurn = turnResult;
    if (turn.content) ctx.output = turn.content;
    await hooks.afterTurn?.(ctx, turn);

    if (turn.toolCalls.length === 0) {
      const decision = (await hooks.onNoToolCalls?.(ctx, turn)) ?? { action: "finish" as const };
      if (decision.action === "continue") continue;
      if (decision.action === "stop") {
        ok = decision.ok ?? false;
        if (decision.output !== undefined) ctx.output = decision.output;
        finished = decision.finished ?? true;
        break;
      }
      if (decision.output !== undefined) ctx.output = decision.output;
      finished = true;
      break;
    }

    const calls = turn.toolCalls.map(parseToolCall);
    const gate = await hooks.beforeToolCalls?.(ctx, turn, calls);
    if (gate?.action === "stop") {
      ok = gate.ok ?? true;
      if (gate.output !== undefined) ctx.output = gate.output;
      finished = gate.finished ?? true;
      break;
    }
    ctx.messages.push(codec.assistant(turn));

    for (let i = 0; i < calls.length; i++) {
      let call = calls[i] as ParsedToolCall;
      let result: LoopDispatchResult | undefined;

      const pre = await hooks.beforeDispatch?.(call, ctx);
      if (pre && "result" in pre) result = pre.result;
      else if (pre && "rewrite" in pre) call = pre.rewrite;

      if (!result) result = await ports.dispatch(call, ctx);

      if (result.control?.kind === "finish") {
        const block = await hooks.onFinish?.(ctx, result.control.summary, call);
        if (block) {
          result = { data: { ok: false, error: block }, isError: true };
        } else {
          finished = true;
          if (result.control.summary) ctx.output = result.control.summary;
        }
      } else if (result.control?.kind === "ask_human") {
        await hooks.onAskHuman?.(ctx, result.control, call);
        awaitingInput = { approvalId: result.control.approvalId, question: result.control.question, callId: call.id };
      }

      // A control signal is the run steering itself, not a tool failing; only a dispatch
      // the surface flagged as an error counts, and any success clears the streak. The
      // skipped remainder of a steered turn is not counted either — those calls never ran.
      if (!result.control) ctx.failureStreak = result.isError ? ctx.failureStreak + 1 : 0;

      const row = codec.tool(call, result);
      ctx.messages.push(row);
      const post = await hooks.afterDispatch?.(call, result, row, ctx);
      if (post?.skipRemaining) {
        const skipped: LoopDispatchResult = { data: post.skipRemaining.data, isError: post.skipRemaining.isError ?? true };
        for (const rest of calls.slice(i + 1)) ctx.messages.push(codec.tool(rest, skipped));
        break;
      }
    }

    const after: AfterToolCallsDecision | void = await hooks.afterToolCalls?.(ctx, finished);
    if (after && after.finished !== undefined) finished = after.finished;
    if (awaitingInput) break;
    if (!finished && ctx.failureStreak >= failureStreakCap) {
      // The turn ran, so it is counted (the for-update is skipped by `break`); a
      // tripped breaker is terminal, so nothing resumes from this index anyway.
      ctx.step++;
      ctx.stepInCall++;
      failuresTripped = true;
      break;
    }
  }

  const exhausted = !finished && !cancelled && !awaitingInput && (failuresTripped || ctx.step >= stepCap);
  return {
    ok,
    output: ctx.output,
    finished,
    cancelled,
    step: ctx.step,
    exhausted,
    ...(exhausted ? { exhaustedBy: failuresTripped ? ("failures" as const) : ("steps" as const) } : {}),
    failureStreak: ctx.failureStreak,
    ...(awaitingInput ? { awaitingInput } : {}),
  };
}
