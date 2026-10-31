/**
 * THE Brain run loop. The model→tools→model skeleton lives ONCE in
 * `@builderforce/agent-loop` — the same kernel the cloud engine, the creation canvas and
 * the on-prem runtime drive. Everything the Brain does differently is a hook or a port
 * closing over this run's state (`RunLoopContext`), each in its own module:
 *
 *   - `runPreamble.ts`     — the catalog, recall / memory answer, directives, the policy;
 *   - `completeTurn.ts`    — the model port (selection, the window fit, retries, re-ask);
 *   - `dispatchTool.ts`    — the tool port (ticket on first edit, guards' advisories);
 *   - `beforeDispatch.ts`  — router, `ask_user` / `hand_off`, confirm gate, read dedupe;
 *   - `toolCallHooks.ts`   — a terminal question, narration, the post-call step;
 *   - `finalAnswerHook.ts` — the end-of-run gates, the reply, the stall failover;
 *   - `runSpendBudget.ts`  — the run's USD cap (warn at 80%, contained stop at the cap).
 *
 * Nothing here iterates. What is left is the forced closing answer when the kernel's
 * consecutive-failure breaker stops the run.
 *
 * There is NO tool-iteration ceiling on a run. A chat turn ends when the model answers,
 * when the user stops it, or when its tool calls keep FAILING — the kernel's
 * consecutive-failure breaker (`DEFAULT_TOOL_FAILURE_STREAK` in `@builderforce/agent-loop`)
 * is the only limit, and it is the same one on every surface. The step ceiling this
 * replaced (25 here, 40 on the native participant, 6 on the server reply) cut off exactly
 * the runs it should not have: a review of forty ticket branches, a rename across a
 * repository, "assign these to the agents and merge them" — long because the work was
 * long, not because the model was stuck. A stuck run announces itself by failing.
 */

import { runAgentLoop, openAiChatCodec } from '@builderforce/agent-loop';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { closeAfterFailureStreak } from './failureClose';
import { completeTurnPort } from './completeTurn';
import { dispatchToolPort } from './dispatchTool';
import { beforeDispatchHook } from './beforeDispatch';
import { afterDispatchHook, beforeToolCallsHook } from './toolCallHooks';
import { skipOnSteer } from './steerInterrupt';
import { finalAnswerHook } from './finalAnswerHook';
import { progressAfterToolCalls } from './progressGuard';
import { runSpendBudget } from './runSpendBudget';
import type { RunLoopContext } from './runLoopContext';

/** The tool row's content: a STRING payload was already budgeted by `trimToolResult` in
 *  dispatch (advisory attached after the cut); anything else is a small stub or error
 *  object the model should read whole. */
const runCodec = openAiChatCodec<ChatCompletionMessage>((r) => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)));

export async function runLoop(run: RunLoopContext): Promise<void> {
  const { c, convo } = run;
  const loop = await runAgentLoop<ChatCompletionMessage>({
    messages: convo,
    codec: runCodec,
    ports: { complete: completeTurnPort(run), dispatch: dispatchToolPort(run) },
    hooks: {
      // The run's USD cap, when it has one: the cost accrues after each turn and is held
      // to the cap before the next (`runSpendBudget.ts`). No cap ⇒ no hooks.
      ...runSpendBudget(run),
      beforeToolCalls: beforeToolCallsHook(run),
      beforeDispatch: beforeDispatchHook(run),
      // The person's message skips the rest of the turn it interrupted (PRD 35 E10).
      afterDispatch: skipOnSteer(run.runKey, afterDispatchHook(run)),
      onNoToolCalls: finalAnswerHook(run),
      afterToolCalls: progressAfterToolCalls(run),
    },
    signal: c.abort?.signal,
    // No step cap. The kernel's consecutive-tool-failure breaker is the run's only
    // limit — see the "no tool-iteration ceiling" note at the top of this module.
    budget: {},
  });
  // A settled reply (the final-answer hook stopped the loop) or a user Stop ends the
  // run here; only a TRIPPED failure breaker falls through to the forced synthesis below.
  if (loop.finished || loop.cancelled) return;

  // The breaker stopped the run: the forced tools-free closing answer is shared with the agent engine (`failureClose.ts`).
  return closeAfterFailureStreak(run, loop.failureStreak, loop.step);
}
