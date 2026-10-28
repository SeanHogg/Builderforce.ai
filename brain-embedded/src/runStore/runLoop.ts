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

import { runAgentLoop, openAiChatCodec, replayTextOf } from '@builderforce/agent-loop';
import { nextTurn } from '@builderforce/run-policy';
import type { ChatCompletionMessage } from '../streamChatCompletion';
import { windowed } from '@seanhogg/builderforce-memory/working';
import type { RunCell } from './runCell';
import { accrueByoUnresolved, accrueProviderCap, emit, emitStreaming, nowIso, nowMs, pushTrace, recordAppended, recordRunFailure } from './runCells';
import { asLiveTurn, canonicalTurnText, connectRetryStep, liveTurnModel, provenanceMetadata } from './turnPersistence';
import { emitEvermindLearnReconcile } from './runMemory';
import { prepareRunLoop } from './runPreamble';
import { completeTurnPort } from './completeTurn';
import { dispatchToolPort } from './dispatchTool';
import { beforeDispatchHook } from './beforeDispatch';
import { afterDispatchHook, beforeToolCallsHook } from './toolCallHooks';
import { skipOnSteer } from './steerInterrupt';
import { finalAnswerHook } from './finalAnswerHook';
import { progressAfterToolCalls } from './progressGuard';
import { runSpendBudget } from './runSpendBudget';
import { noteRunId } from './runEndOutcome';
import type { BrainRunRequest } from './runTypes';

/** The tool row's content: a STRING payload was already budgeted by `trimToolResult` in
 *  dispatch (advisory attached after the cut); anything else is a small stub or error
 *  object the model should read whole. */
const runCodec = openAiChatCodec<ChatCompletionMessage>((r) => (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)));

export async function runLoop(chatId: number, c: RunCell, req: BrainRunRequest, runKey: number): Promise<void> {
  const run = await prepareRunLoop(chatId, c, req, runKey);
  // Memory answered: the run is over before a model was asked.
  if (!run) return;
  // The id this run's calls carry — what its end is reported under (`runEndOutcome.ts`).
  noteRunId(c, run.metadata.guestTurnId);
  const { convo, systemPrompt, metadata } = run;
  const { routingMode, stream, persistence, onActivity, maxTokens, reasoning } = req;
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

  // The breaker stopped the run: its last N tool calls all failed and it never wrote a
  // final answer. Rather than drop the whole run with "kept calling tools without
  // finishing", force ONE final completion WITHOUT tools so the model MUST answer in
  // prose using what it already gathered — the same "always speak" guarantee the
  // server-side addressed-agent loop gives (BrainService.agentReply). The user then
  // reads WHAT kept failing and what is needed, instead of an error; we only surface
  // the loop error if THIS closing turn is also empty. This does not depend on which
  // model answered, so it also rescues a weak auto-selected model that thrashed.
  const streak = loop.failureStreak;
  c.streamingText = '';
  if (!c.abort?.signal.aborted) {
    const closeStart = nowMs();
    try {
      const working: ChatCompletionMessage[] = [
        { role: 'system', content: systemPrompt },
        ...windowed(convo),
        {
          role: 'user',
          content:
            `This turn was stopped because your last ${streak} tool calls all failed. Do NOT call any more tools. Answer the user now, in prose, using what you have already gathered — say what you completed, quote what the failing calls answered, and state plainly what is blocking you and what you need (a different argument, a permission, a decision) so the next turn can succeed.`,
        },
      ];
      let closeFirstTokenAt: number | undefined;
      const closeAsk = nextTurn(run.policy, { hasTools: false });
      const closing = await asLiveTurn(c, () => stream(
        // No `tools` → the model can't call another tool and must produce text.
        { messages: working, model: closeAsk.model, modelStrict: closeAsk.strict, routingMode, maxTokens, reasoning, metadata, signal: c.abort?.signal },
        {
          onModel: liveTurnModel(c),
          onConnectRetry: connectRetryStep(c, loop.step),
          // The first token repaints now; every later delta coalesces into a frame (as `completeTurn` does).
          onTextDelta: (d) => {
            c.streamingText += d;
            if (closeFirstTokenAt === undefined) {
              closeFirstTokenAt = nowMs();
              emit(c);
              return;
            }
            emitStreaming(c);
          },
        },
      ));
      accrueByoUnresolved(c, closing.byoUnresolved);
      accrueProviderCap(c, closing.providerCap);
      // The closing turn may have failed over: its window is the model that answered it.
      run.windowFit.served(closing.resolvedModel ?? closeAsk.model);
      const contextWindow = await run.windowFit.contextWindow?.();
      pushTrace(c, {
        ts: nowIso(),
        category: 'llm',
        label: 'llm.complete',
        durationMs: nowMs() - closeStart,
        ttftMs: closeFirstTokenAt !== undefined ? closeFirstTokenAt - closeStart : undefined,
        args: { model: closing.resolvedModel ?? closeAsk.model ?? 'default', requestedModel: closeAsk.model ?? 'default', step: loop.step, toolCalls: 0, forcedFinish: true, failureStreak: streak, account: closing.account, byoUnresolved: closing.byoUnresolved, ...(contextWindow ? { contextWindow } : {}) },
        usage: closing.usage,
        finishReason: closing.finishReason,
        textChars: closing.text.length,
        result: `forced final synthesis (${streak} consecutive tool failures stopped the run) · ${closing.text.length} chars · finish: ${closing.finishReason ?? '—'}`,
      });
      const closingText = canonicalTurnText(closing.text);
      if (closingText) {
        convo.push({ role: 'assistant', content: replayTextOf(closingText) });
        const meta = provenanceMetadata(closing, closeAsk.model);
        const [assistantMsg] = await persistence.sendMessages(chatId, [{ role: 'assistant', content: closingText, ...(meta ? { metadata: meta } : {}) }]);
        c.streamingText = '';
        recordAppended(c, assistantMsg);
        emit(c);
        // A forced-final answer still contributed server-side — emit the same memory
        // provenance (learn/reconcile steps + answer cache) as the normal branch.
        emitEvermindLearnReconcile(run, assistantMsg, closingText);
        onActivity?.(chatId);
        return;
      }
    } catch (e) {
      // A user Stop during the closing turn exits quietly; any other failure falls
      // through to the loop-exhausted error below (the run still ends, just noisier).
      if (c.abort?.signal.aborted) return;
    }
  }
  if (c.abort?.signal.aborted) return;

  c.streamingText = '';
  recordRunFailure(
    c,
    'agent.loop',
    `Stopped after ${streak} consecutive failed tool calls over ${loop.step} steps (a forced final answer without tools also came back empty)`,
  );
  c.error = `The assistant's last ${streak} tool calls all failed and it gave no answer. Read the failing steps above, then try again with what they ask for.`;
  emit(c);
}
