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
import { detectRepetitionLoop } from "./repetitionLoop.js";

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

/** What {@link raceCancel} settles with when the signal fired first. */
const CANCELLED: unique symbol = Symbol("cancelled");

/**
 * `work`, or {@link CANCELLED} the moment `signal` aborts — whichever is first. A late
 * result (or rejection) of the abandoned work is swallowed here, never unhandled.
 */
function raceCancel<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T | typeof CANCELLED> {
  if (!signal) return work;
  return new Promise<T | typeof CANCELLED>((resolve, reject) => {
    const onAbort = (): void => resolve(CANCELLED);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/** How many calls from `start` may dispatch together: the run of consecutive read-only
 *  calls there, when it is at least two long; otherwise 1 (the sequential path). */
function readOnlySpan(calls: readonly ParsedToolCall[], start: number, isReadOnly: (call: ParsedToolCall) => boolean): number {
  let end = start;
  while (end < calls.length && isReadOnly(calls[end] as ParsedToolCall)) end++;
  return end - start >= 2 ? end - start : 1;
}

export async function runAgentLoop<M>(args: LoopRunArgs<M>): Promise<LoopResult> {
  const { codec, ports, budget, signal } = args;
  const hooks = args.hooks ?? {};
  const ctx = new Ctx<M>(args.messages, signal);
  const startStep = Math.max(0, budget.startStep ?? 0);
  const maxThisCall = budget.maxSteps ?? Number.POSITIVE_INFINITY;
  // Read LIVE, not copied: a surface may widen its own budget mid-run (the canvas
  // does, the moment a turn's first workspace write commits and it becomes a build
  // turn). A copy taken here silently pinned such a run to its opening cap.
  const stepCap = (): number => budget.stepCap ?? Number.POSITIVE_INFINITY;
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

  for (; ctx.step < stepCap() && !finished && ctx.stepInCall < maxThisCall; ctx.step++, ctx.stepInCall++) {
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
    let turn: LoopTurn = turnResult;
    // A turn that arrives stuck repeating one block of prose keeps only what it said
    // before the loop. A streaming surface cuts the loop live; this catches every
    // surface that receives a whole completion at once.
    const looped = turn.content ? detectRepetitionLoop(turn.content) : null;
    if (looped) {
      turn = { ...turn, content: looped.kept };
      await hooks.onRepetitionLoop?.(ctx, looped);
    }
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

    // Settle one dispatched call, in call order: interpret its control signal, count it
    // against the failure streak, push its row and run `afterDispatch`. True ⇒ the hook
    // abandoned the rest of the turn (every later call already has its skipped row).
    const settle = async (i: number, call: ParsedToolCall, dispatched: LoopDispatchResult): Promise<boolean> => {
      let result = dispatched;
      if (result.control?.kind === "finish") {
        const block = await hooks.onFinish?.(ctx, result.control.summary, call);
        if (block) {
          result = { data: { ok: false, error: block }, isError: true };
        } else {
          finished = true;
          if (result.control.summary) ctx.output = result.control.summary;
        }
      } else if (result.control?.kind === "ask_human") {
        const answered = await hooks.onAskHuman?.(ctx, result.control, call);
        // An answer given in-run replaces the parked result: the call's row carries it and
        // the run keeps going. No answer parks the run on the person.
        if (answered) result = answered;
        else awaitingInput = { approvalId: result.control.approvalId, question: result.control.question, callId: call.id };
      }

      // A control signal is the run steering itself, not a tool failing; only a dispatch
      // the surface flagged as an error counts, and any success clears the streak. The
      // skipped remainder of a steered turn is not counted either — those calls never ran.
      if (!result.control) ctx.failureStreak = result.isError ? ctx.failureStreak + 1 : 0;

      const row = codec.tool(call, result);
      ctx.messages.push(row);
      const post = await hooks.afterDispatch?.(call, result, row, ctx);
      if (!post?.skipRemaining) return false;
      const skipped: LoopDispatchResult = { data: post.skipRemaining.data, isError: post.skipRemaining.isError ?? true };
      for (const rest of calls.slice(i + 1)) ctx.messages.push(codec.tool(rest, skipped));
      return true;
    };

    for (let i = 0; i < calls.length; ) {
      // D8: a run of consecutive read-only calls is dispatched together. `beforeDispatch`
      // still runs once per call, in order, BEFORE any of them dispatches; results are
      // settled in call order, so the transcript and every later hook see exactly the
      // sequential shape. A call whose `beforeDispatch` answered with a control signal,
      // or rewrote it into a call that is not read-only, closes the batch at itself.
      const span = ports.isReadOnly ? readOnlySpan(calls, i, ports.isReadOnly) : 1;
      const prepared: Array<{ call: ParsedToolCall; result?: LoopDispatchResult }> = [];
      for (let j = i; j < i + span; j++) {
        let call = calls[j] as ParsedToolCall;
        let result: LoopDispatchResult | undefined;
        const pre = await hooks.beforeDispatch?.(call, ctx);
        if (pre && "result" in pre) result = pre.result;
        else if (pre && "rewrite" in pre) call = pre.rewrite;
        prepared.push(result ? { call, result } : { call });
        if (span > 1 && (result?.control || (!result && !ports.isReadOnly!(call)))) break;
      }
      const last = prepared[prepared.length - 1]!;
      // A batch's trailing non-read-only rewrite runs AFTER the reads before it, alone.
      const tail = prepared.length > 1 && !last.result && !ports.isReadOnly!(last.call) ? last : undefined;
      const batch = tail ? prepared.slice(0, -1) : prepared;
      // A dispatch in flight is RACED against the cancel signal: Stop settles the run
      // `cancelled` now, not when a 10-minute command ends; its late result is dropped.
      const dispatchOne = (p: { call: ParsedToolCall; result?: LoopDispatchResult }) =>
        p.result ? Promise.resolve(p.result) : raceCancel(ports.dispatch(p.call, ctx), signal);
      const results = await Promise.all(batch.map(dispatchOne));
      if (tail && !results.includes(CANCELLED)) results.push(await raceCancel(ports.dispatch(tail.call, ctx), signal));
      if (results.includes(CANCELLED)) {
        // The assistant turn is already in the transcript: every call from here on gets a
        // stopped row, so the history never carries a tool_call without its answer.
        const stopped: LoopDispatchResult = { data: { ok: false, aborted: true, error: "stopped" }, isError: true };
        for (const rest of calls.slice(i)) ctx.messages.push(codec.tool(rest, stopped));
        cancelled = true;
        break;
      }

      let stop = false;
      for (let k = 0; k < prepared.length && !stop; k++) stop = await settle(i + k, prepared[k]!.call, results[k] as LoopDispatchResult);
      if (stop) break;
      i += prepared.length;
    }
    if (cancelled) break;

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

  const exhausted = !finished && !cancelled && !awaitingInput && (failuresTripped || ctx.step >= stepCap());
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
